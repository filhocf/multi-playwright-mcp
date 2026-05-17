# AGENTS.md

## Project Overview

MCP server for browser automation — multi-session Playwright with CDP support. Each `sessionId` gets an isolated browser context. Built with TypeScript, stdio transport. Entry point: `src/index.ts`.

## Architecture

```
src/
├── index.ts             ← Entry point, MCP server setup
├── tools/               ← Tool implementations (navigate, click, type, snapshot, etc.)
├── sessions/            ← Session manager (create, get, close by sessionId)
├── browser/             ← Browser connection (CDP or bundled Chromium)
└── utils/               ← Helpers (screenshot, accessibility tree)
```

**Data flow:** Tool call with `sessionId` → get/create session → execute Playwright action → return result (snapshot, screenshot, or text).

## Key Conventions

- **sessionId**: every tool accepts `sessionId` param. Isolates browser contexts.
- **CDP mode**: set `PLAYWRIGHT_CDP_ENDPOINT=http://localhost:9222` to connect to existing Chromium (preserves logins).
- **Bundled mode**: without CDP, launches headless Chromium per session.
- **Snapshots**: `browser_snapshot` returns accessibility tree (preferred over screenshots for AI agents).
- **Tab management**: `browser_tabs` tool for list/new/close/select operations.

## Adding a New Tool

1. Create tool file in `src/tools/{name}.ts`.
2. Export handler function matching `(params, session) => Promise<result>`.
3. Register in `src/index.ts` with name, description, and JSON schema.
4. Add test in `tests/`.

## Build & Test

```bash
npm ci && npm run build   # Compile TypeScript
npm test                  # Run tests
```

- Output: `dist/index.js` (Node.js executable).
- Global install: `npm install -g .` → `multi-playwright-mcp` command available.
