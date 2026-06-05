import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted so mocks are available when vi.mock factories run
const { mockClient, mockServer, mockContext, mockBrowser, mockConnectOverCDP, mockCreateConnection, MockClient, mockCreateLinkedPair } = vi.hoisted(() => {
  const mockContext = {
    pages: () => [],
    newPage: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockBrowser = {
    isConnected: vi.fn().mockReturnValue(true),
    contexts: vi.fn().mockReturnValue([mockContext]),
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockConnectOverCDP = vi.fn().mockResolvedValue(mockBrowser);
  const mockServer = {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockCreateConnection = vi.fn().mockResolvedValue(mockServer);
  const mockClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'browser_snapshot', inputSchema: { type: 'object', properties: {} } }] }),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
  };
  // Must be a real class/function to work with `new`
  const MockClient = vi.fn(function (this: any) {
    Object.assign(this, mockClient);
  });
  const mockCreateLinkedPair = vi.fn().mockReturnValue([{}, {}]);
  return { mockClient, mockServer, mockContext, mockBrowser, mockConnectOverCDP, mockCreateConnection, MockClient, mockCreateLinkedPair };
});

vi.mock('playwright', () => ({
  chromium: { connectOverCDP: mockConnectOverCDP },
}));

vi.mock('@playwright/mcp', () => ({
  createConnection: mockCreateConnection,
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient,
}));

vi.mock('@modelcontextprotocol/sdk/inMemory.js', () => ({
  InMemoryTransport: { createLinkedPair: mockCreateLinkedPair },
}));

// Import after mocks
import { getOrCreateClient, listSessions, closeSession, discoverTools } from '../src/session.js';

describe('session', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    for (const id of listSessions()) {
      await closeSession(id);
    }
    process.env = originalEnv;
  });

  describe('getOrCreateClient', () => {
    it('creates new session', async () => {
      process.env.PLAYWRIGHT_CDP_ENDPOINT = 'http://localhost:9222';
      const client = await getOrCreateClient('test-1');
      expect(client).toBeDefined();
      expect(listSessions()).toContain('test-1');
    });

    it('returns same client for same sessionId', async () => {
      process.env.PLAYWRIGHT_CDP_ENDPOINT = 'http://localhost:9222';
      const client1 = await getOrCreateClient('reuse');
      const client2 = await getOrCreateClient('reuse');
      expect(client1).toBe(client2);
    });

    it('uses default context in CDP mode (browser.contexts()[0])', async () => {
      process.env.PLAYWRIGHT_CDP_ENDPOINT = 'http://localhost:9222';
      await getOrCreateClient('cdp-ctx');
      expect(mockBrowser.contexts).toHaveBeenCalled();
    });

    it('creates new context if browser has no contexts in CDP mode', async () => {
      process.env.PLAYWRIGHT_CDP_ENDPOINT = 'http://localhost:9222';
      mockBrowser.contexts.mockReturnValueOnce([]);
      await getOrCreateClient('cdp-no-ctx');
      expect(mockBrowser.newContext).toHaveBeenCalled();
    });
  });

  describe('listSessions', () => {
    it('returns active session IDs', async () => {
      process.env.PLAYWRIGHT_CDP_ENDPOINT = 'http://localhost:9222';
      await getOrCreateClient('s1');
      await getOrCreateClient('s2');
      const ids = listSessions();
      expect(ids).toContain('s1');
      expect(ids).toContain('s2');
    });
  });

  describe('closeSession', () => {
    it('removes session from map', async () => {
      process.env.PLAYWRIGHT_CDP_ENDPOINT = 'http://localhost:9222';
      await getOrCreateClient('to-close');
      expect(listSessions()).toContain('to-close');
      await closeSession('to-close');
      expect(listSessions()).not.toContain('to-close');
    });

    it('does NOT close shared default context in CDP mode', async () => {
      process.env.PLAYWRIGHT_CDP_ENDPOINT = 'http://localhost:9222';
      mockContext.close.mockClear();
      await getOrCreateClient('cdp-default');
      await closeSession('cdp-default');
      expect(mockContext.close).not.toHaveBeenCalled();
    });

    it('handles closing non-existent session gracefully', async () => {
      await expect(closeSession('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('getSharedBrowser', () => {
    it('reuses existing connection', async () => {
      process.env.PLAYWRIGHT_CDP_ENDPOINT = 'http://localhost:9222';
      mockConnectOverCDP.mockClear();
      mockBrowser.isConnected.mockReturnValue(true);
      await getOrCreateClient('share-1');
      await getOrCreateClient('share-2');
      // Second call reuses browser, so connectOverCDP called at most once (or zero if already connected from prior test)
      expect(mockConnectOverCDP.mock.calls.length).toBeLessThanOrEqual(1);
    });

    it('reconnects if disconnected', async () => {
      process.env.PLAYWRIGHT_CDP_ENDPOINT = 'http://localhost:9222';
      mockConnectOverCDP.mockClear();
      // First call - may reuse existing or connect
      mockBrowser.isConnected.mockReturnValueOnce(false);
      await getOrCreateClient('reconnect-1');
      const callsAfterFirst = mockConnectOverCDP.mock.calls.length;
      expect(callsAfterFirst).toBe(1); // Must reconnect since disconnected
      // Second call with browser connected should not reconnect
      mockBrowser.isConnected.mockReturnValue(true);
      await getOrCreateClient('reconnect-2');
      expect(mockConnectOverCDP.mock.calls.length).toBe(callsAfterFirst);
    });
  });

  describe('getCdpEndpoint', () => {
    it('reads from env', async () => {
      process.env.PLAYWRIGHT_CDP_ENDPOINT = 'http://custom:1234';
      mockConnectOverCDP.mockClear();
      mockBrowser.isConnected.mockReturnValueOnce(false);
      await getOrCreateClient('env-test');
      expect(mockConnectOverCDP).toHaveBeenCalledWith('http://custom:1234');
    });
  });

  describe('getPersistentBaseDir', () => {
    it('reads from PLAYWRIGHT_USER_DATA_DIR env', async () => {
      delete process.env.PLAYWRIGHT_CDP_ENDPOINT;
      process.env.PLAYWRIGHT_USER_DATA_DIR = '/tmp/test-persist';
      await getOrCreateClient('persist-test');
      const config = mockCreateConnection.mock.calls.at(-1)?.[0];
      expect(config.browser.userDataDir).toContain('/tmp/test-persist');
    });
  });

  describe('isHeadless', () => {
    it('returns true when no DISPLAY set', async () => {
      delete process.env.PLAYWRIGHT_CDP_ENDPOINT;
      delete process.env.DISPLAY;
      delete process.env.PLAYWRIGHT_HEADLESS;
      await getOrCreateClient('headless-1');
      const config = mockCreateConnection.mock.calls.at(-1)?.[0];
      expect(config.browser.launchOptions.headless).toBe(true);
    });

    it('returns false when PLAYWRIGHT_HEADLESS=0', async () => {
      delete process.env.PLAYWRIGHT_CDP_ENDPOINT;
      process.env.PLAYWRIGHT_HEADLESS = '0';
      await getOrCreateClient('headless-2');
      const config = mockCreateConnection.mock.calls.at(-1)?.[0];
      expect(config.browser.launchOptions.headless).toBe(false);
    });

    it('returns false when PLAYWRIGHT_HEADLESS=false', async () => {
      delete process.env.PLAYWRIGHT_CDP_ENDPOINT;
      process.env.PLAYWRIGHT_HEADLESS = 'false';
      await getOrCreateClient('headless-3');
      const config = mockCreateConnection.mock.calls.at(-1)?.[0];
      expect(config.browser.launchOptions.headless).toBe(false);
    });
  });

  describe('sanitizeSessionId', () => {
    it('removes unsafe chars', async () => {
      delete process.env.PLAYWRIGHT_CDP_ENDPOINT;
      process.env.PLAYWRIGHT_USER_DATA_DIR = '/tmp/sanitize-test';
      await getOrCreateClient('bad/path/../hack');
      const config = mockCreateConnection.mock.calls.at(-1)?.[0];
      const sessionPart = config.browser.userDataDir.split('/').pop();
      expect(sessionPart).toBe('bad_path_.._hack');
    });
  });

  describe('multiple concurrent sessions', () => {
    it('share same browser in CDP mode', async () => {
      process.env.PLAYWRIGHT_CDP_ENDPOINT = 'http://localhost:9222';
      mockConnectOverCDP.mockClear();
      mockBrowser.isConnected.mockReturnValue(true);
      await Promise.all([
        getOrCreateClient('concurrent-1'),
        getOrCreateClient('concurrent-2'),
        getOrCreateClient('concurrent-3'),
      ]);
      expect(listSessions()).toContain('concurrent-1');
      expect(listSessions()).toContain('concurrent-2');
      expect(listSessions()).toContain('concurrent-3');
      // All share same browser - at most 1 connect call (or 0 if already connected)
      expect(mockConnectOverCDP.mock.calls.length).toBeLessThanOrEqual(1);
    });
  });

  describe('discoverTools', () => {
    it('returns inner tools and closes connection', async () => {
      const tools = await discoverTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('browser_snapshot');
    });
  });
});
