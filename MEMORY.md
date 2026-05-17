# MEMORY.md — multi-playwright-mcp

## Estado Atual

- **Versão**: 1.2.2
- **Transporte**: stdio
- **Modo CDP**: PLAYWRIGHT_CDP_ENDPOINT=http://localhost:9222
- **Fork de**: microsoft/playwright-mcp (com multi-session adicionado)

## Features vs Upstream

- sessionId em todas as tools (isolamento de contexto)
- CDP mode (conecta ao Chromium do usuário, preserva logins)
- Múltiplas abas por sessão

## Pendente

- Fork limpo do upstream mais recente
- PR upstream com multi-session
