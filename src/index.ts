import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  discoverTools,
  getOrCreateClient,
  listSessions,
  closeSession,
  closeAllSessions,
} from './session.js';

const SESSION_ID_PARAM = {
  type: 'string' as const,
  description: 'Browser session identifier. Each unique ID gets its own isolated browser.',
};

let cachedTools: Tool[] | null = null;

async function getInnerTools(): Promise<Tool[]> {
  if (!cachedTools) {
    cachedTools = await discoverTools();
  }
  return cachedTools;
}

/** Inject sessionId into each inner tool's input schema. */
function wrapToolSchemas(tools: Tool[]): Tool[] {
  return tools.map((tool) => ({
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        sessionId: SESSION_ID_PARAM,
        ...(tool.inputSchema.properties ?? {}),
      },
      required: ['sessionId', ...((tool.inputSchema as any).required ?? [])],
    },
  }));
}

const MANAGEMENT_TOOLS: Tool[] = [
  {
    name: 'list_sessions',
    description: 'List all active browser session IDs',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'close_session',
    description: 'Close a browser session and free its resources',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID_PARAM,
      },
      required: ['sessionId'],
    },
  },
];

const server = new Server(
  { name: 'multi-playwright-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const innerTools = await getInnerTools();
  return { tools: [...wrapToolSchemas(innerTools), ...MANAGEMENT_TOOLS] };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Handle management tools
  if (name === 'list_sessions') {
    return {
      content: [{ type: 'text', text: JSON.stringify(listSessions()) }],
    };
  }

  if (name === 'close_session') {
    const sessionId = (args as any)?.sessionId;
    if (!sessionId) throw new Error('sessionId is required');
    await closeSession(sessionId);
    return {
      content: [{ type: 'text', text: `Session "${sessionId}" closed` }],
    };
  }

  // Proxy to inner @playwright/mcp client
  const sessionId = (args as any)?.sessionId;
  if (!sessionId) throw new Error('sessionId is required');

  const { sessionId: _, ...innerArgs } = args as Record<string, unknown>;
  const client = await getOrCreateClient(sessionId);
  return await client.callTool({ name, arguments: innerArgs });
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('multi-playwright-mcp running on stdio');

  process.on('SIGINT', async () => {
    await closeAllSessions();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
