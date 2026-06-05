# PRD — multi-playwright-mcp v2.0.0

## Vision

The browser that AI agents deserve: persistent, multi-session, with real logins — not a disposable sandbox.

## Problem

Existing browser MCPs (Playwright MCP, Browserbase, etc.) create fresh contexts on every use. Logins are lost, cookies disappear, and each agent session starts from zero. For AI developers who run 3-5 concurrent agent sessions daily, this means:

- Re-authenticating on every Google/GitHub/portal access
- No continuity between sessions
- No way to share browser state across agents
- Context isolation where collaboration is needed

## Target Users

| Persona | Use Case |
|---------|----------|
| **AI developer (primary)** | Runs multiple Kiro/Claude/Cursor sessions, needs browser with logins |
| **Agent orchestrator** | Multi-agent workflows where each agent needs web access |
| **Automation builder** | Scheduled monitoring, form filling, data extraction |
| **QA engineer** | E2E testing with persistent test accounts |

## Core Value Proposition

> One browser, all your agents, all your logins — no re-authentication, no state loss.

## Features

### v2.0.0 (current release)

| Feature | Status | Description |
|---------|:---:|-------------|
| Multi-session | ✅ | Each sessionId gets isolated tabs within shared browser |
| CDP attach | ✅ | Connects to existing Chromium via Chrome DevTools Protocol |
| Login persistence | ✅ | Default context shared across all sessions (cookies, localStorage) |
| 44+ Playwright tools | ✅ | navigate, click, fill, screenshot, evaluate, tabs, network, storage |
| Headless/headed modes | ✅ | PLAYWRIGHT_HEADLESS env var |
| Persistent profiles (non-CDP) | ✅ | userDataDir per sessionId when CDP not used |
| Storage state save/restore | ✅ | browser_storage_state / browser_set_storage_state |
| Network route mocking | ✅ | browser_route / browser_unroute |

### v2.1.0 (planned)

| Feature | Priority | Description |
|---------|:---:|-------------|
| Semantic tab search | P1 | Query content across all open tabs by semantic meaning |
| PDF generation | P1 | Render current page as PDF (browser_pdf tool) |
| Screenshot annotation | P2 | Mark interactive elements in screenshots for vision LLMs |
| Session auto-cleanup | P2 | TTL-based cleanup of stale sessions |

### v2.2.0 (planned)

| Feature | Priority | Description |
|---------|:---:|-------------|
| Scheduled monitoring | P1 | Cron-like: check URL every N min, alert on change |
| Network capture/export | P1 | Export HAR files for API debugging |
| Workflow recording | P2 | Record manual actions → replay as automation |
| Cross-machine state sync | P2 | Export/import browser state between machines |

### v3.0.0 (future)

| Feature | Priority | Description |
|---------|:---:|-------------|
| WebMCP client | P1 | Consume tools declared by websites (Chrome WebMCP standard) |
| Anti-detection mode | P2 | Fingerprint masking for sites with bot protection |
| Cloud mode | P3 | Optional Browserbase/remote browser backend |

## Architecture

```
┌─────────────────────────────────────────────────┐
│ AI Agent (Kiro CLI / Claude Code / OpenClaw)    │
└──────────────────────┬──────────────────────────┘
                       │ MCP (stdio)
┌──────────────────────▼──────────────────────────┐
│ multi-playwright-mcp                             │
│  ├── index.ts (MCP server, tool dispatch)        │
│  ├── session.ts (session mgmt, CDP connect)      │
│  └── tools/* (future: modular tool files)        │
└──────────────────────┬──────────────────────────┘
                       │ CDP / Playwright API
┌──────────────────────▼──────────────────────────┐
│ Chromium (user's browser, port 9222)             │
│  └── Default Context (logins, cookies, state)    │
│       ├── Tab: Session "a" pages                 │
│       ├── Tab: Session "b" pages                 │
│       └── Tab: Session "c" pages                 │
└─────────────────────────────────────────────────┘
```

## Non-Goals

- Not a scraping platform (no proxy rotation, no CAPTCHA bypass)
- Not a cloud service (local-first, your machine, your browser)
- Not a testing framework (use Playwright directly for test suites)
- Not a replacement for Playwright — it's a MCP wrapper around it

## Success Metrics

| Metric | Target |
|--------|--------|
| Login persistence across sessions | 100% (same browser = same logins) |
| Concurrent sessions without conflict | 5+ |
| Cold start time (CDP mode) | <3s |
| Tool response latency (p95) | <500ms |
| Test coverage | >70% |

## Competitive Positioning

| | Playwright MCP | mcp-chrome | Browser Use | **Ours** |
|---|:---:|:---:|:---:|:---:|
| Multi-session | ❌ | ❌ | ❌ | ✅ |
| Login persistence | ❌ | ✅ | ✅ (profiles) | ✅ |
| CDP attach | ❌ | Extension | ❌ | ✅ (native) |
| No extension needed | ✅ | ❌ | ✅ | ✅ |
| 44+ tools | ✅ | ~20 | ~10 | ✅ |
| Local-first | ✅ | ✅ | Both | ✅ |

## Technical Requirements

- Node.js 22+
- Chromium with `--remote-debugging-port=9222` for CDP mode
- Playwright (bundled)
- TypeScript (strict mode)
- Zero native dependencies
