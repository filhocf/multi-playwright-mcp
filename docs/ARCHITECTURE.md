# Architecture — multi-playwright-mcp

## Overview

Node.js MCP server that wraps `@playwright/mcp` to add multi-browser-instance support. Each `sessionId` gets an isolated browser instance. Backward compatible — all original Playwright MCP tools work unchanged.

## Stack

- **Runtime**: Node.js (CommonJS)
- **Protocol**: MCP via `@modelcontextprotocol/sdk`, stdio transport
- **Browser**: `@playwright/mcp` (official Playwright MCP server)
- **Language**: TypeScript → compiled to `dist/`

## Module Layout

```
src/
├── index.ts     # MCP server — tool schema injection, request routing, lifecycle
└── session.ts   # Session management — browser instance pool, cleanup
```

## Design: Proxy Pattern

The server acts as a multiplexing proxy in front of `@playwright/mcp`:

```
AI Agent ──stdio──▶ multi-playwright-mcp ──InMemoryTransport──▶ @playwright/mcp (per session)
```

1. On startup, discovers available tools from a temporary `@playwright/mcp` connection
2. Re-exposes all tools with an injected `sessionId` parameter
3. Routes each tool call to the correct session's inner client
4. Adds management tools (`list_sessions`, `close_session`)

## Session Isolation

Each unique `sessionId` creates:
- A dedicated `@playwright/mcp` server instance
- An in-memory MCP client↔server transport pair
- An isolated Chromium browser (persistent profile by default)

Sessions are stored in a `Map<string, { server, client }>`.

## Persistence

- **User data dirs**: `~/.local/share/playwright-sessions/<sessionId>/` (override via `PLAYWRIGHT_USER_DATA_DIR`)
- **Storage state**: auto-loads `<sessionId>.state.json` if present
- Allows login persistence across sessions

## Lifecycle & Cleanup

- **Graceful shutdown**: SIGINT/SIGTERM/SIGHUP → close all sessions → exit
- **Parent watchdog**: polls `process.ppid` every 1s; exits if orphaned (parent died)
- **Orphan sweep**: on startup, kills stale `multi-playwright-mcp` processes whose parent is dead
- **Session close**: terminates Chromium, removes lock files, cleans up profile locks

## Tool Schema Injection

All inner tools get `sessionId` added to their `inputSchema.properties` and `required` array. This is done at discovery time via `wrapToolSchemas()`.

## Management Tools

| Tool | Purpose |
|------|---------|
| `list_sessions` | Return array of active session IDs |
| `close_session` | Terminate a session's browser and free resources |

## Configuration (Environment Variables)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PLAYWRIGHT_HEADLESS` | auto (no DISPLAY → headless) | Force headless/headed mode |
| `PLAYWRIGHT_USER_DATA_DIR` | `~/.local/share/playwright-sessions/` | Persistent profile base dir (empty = disable) |

## File Chooser Handling

Before each tool call (except `browser_file_upload`), stale file chooser modals are auto-cancelled to prevent blocking. This handles sites that trigger excessive file chooser events.
