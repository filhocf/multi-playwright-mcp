import { createConnection } from '@playwright/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium, type Browser, type BrowserContext } from 'playwright';

export interface SessionEntry {
  server: Server;
  client: Client;
  context?: BrowserContext;
}

const sessions = new Map<string, SessionEntry>();
let sharedBrowser: Browser | null = null;

/**
 * Get or create the shared CDP browser connection.
 * All sessions share one browser but get isolated contexts.
 */
async function getSharedBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  const endpoint = getCdpEndpoint()!;
  sharedBrowser = await chromium.connectOverCDP(endpoint);
  return sharedBrowser;
}

function isHeadless(): boolean {
  const env = process.env.PLAYWRIGHT_HEADLESS;
  if (env !== undefined) return env !== '0' && env.toLowerCase() !== 'false';
  return !process.env.DISPLAY;
}

/**
 * Sanitize sessionId for use as a directory name.
 * Allows alphanumeric, hyphens, underscores, and dots.
 */
function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Returns the base directory for persistent session data.
 * Defaults to ~/.local/share/playwright-sessions/ for login persistence.
 * Set PLAYWRIGHT_USER_DATA_DIR to override, or set to empty string to disable persistence.
 */
function getPersistentBaseDir(): string | undefined {
  const env = process.env.PLAYWRIGHT_USER_DATA_DIR;
  if (env === '') return undefined; // explicitly disabled
  if (env) return env;
  // Default: persist sessions for login reuse
  return join(homedir(), '.local', 'share', 'playwright-sessions');
}

/**
 * Returns CDP endpoint URL if configured.
 * Set PLAYWRIGHT_CDP_ENDPOINT to connect to an existing Chromium instance.
 * Example: PLAYWRIGHT_CDP_ENDPOINT=http://localhost:9222
 */
function getCdpEndpoint(): string | undefined {
  return process.env.PLAYWRIGHT_CDP_ENDPOINT || undefined;
}

function getConnectionConfig(sessionId?: string) {
  const cdpEndpoint = getCdpEndpoint();
  const baseDir = getPersistentBaseDir();
  const persistent = !!baseDir && !!sessionId;

  const config: Record<string, unknown> = {
    browserName: 'chromium' as const,
    launchOptions: { headless: isHeadless(), channel: 'chromium' },
  };

  // CDP mode: connect to existing browser, ignore launch/persistence options
  if (cdpEndpoint) {
    config.cdpEndpoint = cdpEndpoint;
    config.cdpTimeout = parseInt(process.env.PLAYWRIGHT_CDP_TIMEOUT || '30000', 10);
    // Don't set userDataDir or isolated — CDP attaches to existing browser
    delete config.launchOptions;
  } else if (persistent) {
    const dir = join(baseDir!, sanitizeSessionId(sessionId!));
    mkdirSync(dir, { recursive: true });
    config.userDataDir = dir;
    config.isolated = false;
  } else {
    config.isolated = true;
  }

  // Load storageState if a saved state file exists for this session (non-CDP only)
  if (!cdpEndpoint && sessionId && baseDir) {
    const stateFile = join(baseDir!, `${sanitizeSessionId(sessionId)}.state.json`);
    if (existsSync(stateFile)) {
      config.contextOptions = { storageState: stateFile };
    }
  }

  return {
    browser: config,
    capabilities: ['core', 'core-navigation', 'core-tabs', 'core-input', 'core-install', 'network', 'storage'] as any[],
  };
}

export async function getOrCreateClient(sessionId: string): Promise<Client> {
  const existing = sessions.get(sessionId);
  if (existing) return existing.client;

  const cdpEndpoint = getCdpEndpoint();
  let server: Server;
  let context: BrowserContext | undefined;

  if (cdpEndpoint) {
    // CDP mode: each session gets its own BrowserContext (isolated tabs)
    const browser = await getSharedBrowser();
    context = await browser.newContext();
    server = await createConnection(getConnectionConfig(sessionId), () => Promise.resolve(context!));
  } else {
    server = await createConnection(getConnectionConfig(sessionId));
  }

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: `session-${sessionId}`, version: '1.0.0' });
  await client.connect(clientTransport);

  sessions.set(sessionId, { server, client, context });
  return client;
}

/** Discover available tools from a temporary inner connection. */
export async function discoverTools(): Promise<Tool[]> {
  const config = getConnectionConfig();
  const server = await createConnection(config);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'tool-discovery', version: '1.0.0' });
  await client.connect(clientTransport);

  const { tools } = await client.listTools();

  await client.close();
  await server.close();

  return tools;
}

export function listSessions(): string[] {
  return Array.from(sessions.keys());
}

export async function closeSession(sessionId: string): Promise<void> {
  const entry = sessions.get(sessionId);
  if (!entry) return;

  await entry.client.close();
  await entry.server.close();

  // CDP mode: close the isolated context (closes its tabs)
  if (entry.context) {
    await entry.context.close().catch(() => {});
  }

  sessions.delete(sessionId);

  // server.close() doesn't always terminate the Chromium process.
  // Wait briefly then clean up stale lock files so the profile can be reused.
  await new Promise(resolve => setTimeout(resolve, 500));

  const baseDir = getPersistentBaseDir();
  if (baseDir && sessionId) {
    const { unlink } = await import('node:fs/promises');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const dir = join(baseDir, sanitizeSessionId(sessionId));

    // Kill any lingering Chromium processes using this profile (Unix only)
    if (process.platform !== 'win32') {
      try {
        await execFileAsync('pkill', ['-f', `user-data-dir=${dir}`], { timeout: 3000 });
      } catch { /* ignore - process may already be gone */ }
    }

    // Wait for process to die and release locks
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Remove lock files concurrently
    await Promise.all(
      ['SingletonLock', 'SingletonSocket', 'SingletonCookie'].map(async (lock) => {
        try { await unlink(join(dir, lock)); } catch { /* ignore */ }
      })
    );
  }
}

export async function closeAllSessions(): Promise<void> {
  for (const id of sessions.keys()) {
    await closeSession(id);
  }
}
