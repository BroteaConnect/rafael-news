# Brotea News — Rafael Ojeda

Financial news portal: a curated front page with the day's stories, a market
bar, the newsletter and the analyst behind it. Server-rendered Astro (node
adapter), Spanish by default at `/`, English at `/en/`.

## About
- **Project:** Rafael Ojeda News (`rafael-news`)
- **Content:** the front page reads from a typed seed module
  (`src/lib/content/`). Its accessors are the contract — the next feature
  swaps their bodies for database queries and no page changes.

## Configuration
- `PUBLIC_REQUIREMENTS_ENDPOINT` — where `POST /api/newsletter` forwards a
  subscription, server-side (`{project, source, submitted_by, content}`). It
  has a compiled default, so the form works without setting it.

## MCP
- `POST /api/mcp` is a remote MCP server: Claude, from another client, can
  search and read the portal and write **drafts** (never publish) with a bearer
  key minted at `/admin/mcp`. See [docs/mcp.md](./docs/mcp.md).

## Commands
- `npm install` · `npm run dev` · `npm test`
- `npm run build` → `dist/server/` (the server) + `dist/client/` (assets);
  run it with `node ./dist/server/entry.mjs`.

Deployment, the `runtime` service contract and the Coolify setup live in
[docs/deployment.md](./docs/deployment.md).
