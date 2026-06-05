# ROADMAP — multi-playwright-mcp

## v2.0.0 ✅ (current)

- [x] Multi-session (sessionId → isolated tabs)
- [x] CDP attach (connect to existing Chromium)
- [x] Login persistence (default context shared)
- [x] 44+ Playwright tools
- [x] Storage state save/restore
- [x] Network route mocking
- [ ] Tests (0% → 70%+ coverage)
- [ ] PRD + ROADMAP + AGENTS.md update

## v2.1.0 (next)

- [ ] Semantic tab search (query content across all tabs)
- [ ] PDF generation (browser_pdf tool)
- [ ] Screenshot annotation (mark interactive elements)
- [ ] Session TTL auto-cleanup
- [ ] CI: lint + tsc + test on push/PR

## v2.2.0

- [ ] Scheduled monitoring (cron: check URL, alert on change)
- [ ] Network capture/export (HAR files)
- [ ] Workflow recording/replay
- [ ] Cross-machine state sync (export/import)

## v3.0.0 (future)

- [ ] WebMCP client (consume website-declared tools)
- [ ] Anti-detection mode (fingerprint masking)
- [ ] Cloud mode (optional remote browser backend)

## Release Policy

- SemVer: major = breaking, minor = features, patch = fixes
- Breaking: changing default context behavior, removing tools
- Tags: `vX.Y.Z` on main
- Publish: npm (when ready for public use)
