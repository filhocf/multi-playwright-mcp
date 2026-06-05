import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const { mockCallTool, mockGetOrCreateClient, mockListSessions, mockCloseSession, mockDiscoverTools } = vi.hoisted(() => {
  const mockCallTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] });
  const mockGetOrCreateClient = vi.fn().mockResolvedValue({
    connect: vi.fn(),
    close: vi.fn(),
    callTool: mockCallTool,
  });
  const mockListSessions = vi.fn().mockReturnValue(['session-a', 'session-b']);
  const mockCloseSession = vi.fn().mockResolvedValue(undefined);
  const mockDiscoverTools = vi.fn().mockResolvedValue([
    {
      name: 'browser_snapshot',
      description: 'Take a snapshot',
      inputSchema: { type: 'object', properties: { ref: { type: 'string' } }, required: [] },
    },
    {
      name: 'browser_navigate',
      description: 'Navigate to URL',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
  ]);
  return { mockCallTool, mockGetOrCreateClient, mockListSessions, mockCloseSession, mockDiscoverTools };
});

vi.mock('../src/session.js', () => ({
  discoverTools: mockDiscoverTools,
  getOrCreateClient: mockGetOrCreateClient,
  listSessions: mockListSessions,
  closeSession: mockCloseSession,
  closeAllSessions: vi.fn().mockResolvedValue(undefined),
}));

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

async function createTestServer() {
  const SESSION_ID_PARAM = { type: 'string' as const, description: 'Browser session identifier.' };

  const MANAGEMENT_TOOLS = [
    { name: 'list_sessions', description: 'List all active browser session IDs', inputSchema: { type: 'object' as const, properties: {} } },
    { name: 'close_session', description: 'Close a browser session', inputSchema: { type: 'object' as const, properties: { sessionId: SESSION_ID_PARAM }, required: ['sessionId'] } },
  ];

  const server = new Server(
    { name: 'multi-playwright-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const innerTools = await mockDiscoverTools();
    const wrapped = innerTools.map((tool: any) => ({
      ...tool,
      inputSchema: {
        ...tool.inputSchema,
        properties: { sessionId: SESSION_ID_PARAM, ...(tool.inputSchema.properties ?? {}) },
        required: ['sessionId', ...(tool.inputSchema.required ?? [])],
      },
    }));
    return { tools: [...wrapped, ...MANAGEMENT_TOOLS] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params;

    if (name === 'list_sessions') {
      return { content: [{ type: 'text', text: JSON.stringify(mockListSessions()) }] };
    }
    if (name === 'close_session') {
      const sessionId = args?.sessionId;
      if (!sessionId) throw new Error('sessionId is required');
      await mockCloseSession(sessionId);
      return { content: [{ type: 'text', text: `Session "${sessionId}" closed` }] };
    }

    const sessionId = args?.sessionId;
    if (!sessionId) throw new Error('sessionId is required');
    const { sessionId: _, ...innerArgs } = args as Record<string, unknown>;
    const client = await mockGetOrCreateClient(sessionId);
    return await client.callTool({ name, arguments: innerArgs });
  });

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return { server, client };
}

describe('index (MCP server)', () => {
  let server: Server;
  let client: Client;

  beforeAll(async () => {
    const pair = await createTestServer();
    server = pair.server;
    client = pair.client;
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it('server has list_sessions tool', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t: any) => t.name)).toContain('list_sessions');
  });

  it('server has close_session tool', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t: any) => t.name)).toContain('close_session');
  });

  it('all inner tools get sessionId injected in schema', async () => {
    const { tools } = await client.listTools();
    const snapshot = tools.find((t: any) => t.name === 'browser_snapshot');
    expect(snapshot!.inputSchema.properties).toHaveProperty('sessionId');
    expect(snapshot!.inputSchema.required).toContain('sessionId');
  });

  it('tool dispatch routes to correct session client', async () => {
    await client.callTool({ name: 'browser_snapshot', arguments: { sessionId: 'my-session' } });
    expect(mockGetOrCreateClient).toHaveBeenCalledWith('my-session');
    expect(mockCallTool).toHaveBeenCalledWith({ name: 'browser_snapshot', arguments: {} });
  });

  it('list_sessions returns JSON array', async () => {
    const result = await client.callTool({ name: 'list_sessions', arguments: {} });
    const parsed = JSON.parse((result as any).content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toContain('session-a');
  });

  it('close_session with valid ID succeeds', async () => {
    const result = await client.callTool({ name: 'close_session', arguments: { sessionId: 'session-a' } });
    expect((result as any).content[0].text).toContain('closed');
    expect(mockCloseSession).toHaveBeenCalledWith('session-a');
  });

  it('close_session with missing sessionId returns error', async () => {
    await expect(client.callTool({ name: 'close_session', arguments: {} })).rejects.toThrow();
  });

  it('unknown tool without sessionId returns error', async () => {
    await expect(client.callTool({ name: 'nonexistent_tool', arguments: {} })).rejects.toThrow();
  });

  it('inner tool forwards args without sessionId', async () => {
    mockCallTool.mockClear();
    await client.callTool({ name: 'browser_navigate', arguments: { sessionId: 'nav-session', url: 'https://example.com' } });
    expect(mockCallTool).toHaveBeenCalledWith({ name: 'browser_navigate', arguments: { url: 'https://example.com' } });
  });

  it('inner tool without sessionId throws error', async () => {
    await expect(client.callTool({ name: 'browser_navigate', arguments: { url: 'https://example.com' } })).rejects.toThrow();
  });
});
