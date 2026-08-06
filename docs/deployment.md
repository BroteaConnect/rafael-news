# Deployment

Brotea News is a **server-rendered** Astro app (node adapter, standalone)
packaged as a Docker image and deployed to Coolify by the Brotea factory.
Until feature 57 it was a static site served by nginx; it is not any more.

## Docker image

The `Dockerfile` at the repo root has three stages:

1. **deps** — `node:22-alpine`, `npm ci --omit=dev`: the modules the server
   needs at runtime, without the dev half (typescript, `@astrojs/check`).
2. **build** — `npm ci` + `npm run build`, producing `dist/server/` (the node
   server) and `dist/client/` (assets). **There is no `dist/index.html`
   any more** — anything that greps for it is broken by definition.
3. **runtime** — `node:22-alpine` running `node ./dist/server/entry.mjs`
   with `HOST=0.0.0.0` and `PORT=4321`.

`HOST=0.0.0.0` is not optional: the adapter listens on localhost by default,
and inside a container that means nobody outside can reach it.

```bash
docker build -t rafael-news .
docker run -p 8080:4321 rafael-news
curl -i localhost:8080/healthz   # 200
```

## Service contract

`brotea.json` carries the contract the factory's quality gate reads:

```json
"runtime": { "port": 4321, "health": "/healthz" }
```

CI starts the image and curls `runtime.health` on `runtime.port`; the health
route answers from the image alone, with no database and no outbound call, so
that a network blip never marks a healthy app as down.

## Build ARG: `PUBLIC_REQUIREMENTS_ENDPOINT`

The newsletter intake (`POST /api/newsletter`) forwards subscriptions
server-side to this URL. Astro inlines `PUBLIC_*` at **build time**, so it must
be set before `npm run build`; it cannot be injected at container runtime.

It has a compiled default (`https://api.brotea.dev/requirements`), so a build
without the ARG still ships a working form. The build fails fast if no absolute
intake URL made it into the server bundle:

```dockerfile
RUN grep -rqE 'https://[a-z0-9.-]+/requirements' dist/server/
```

## Coolify setup

- Build pack: `dockerfile`.
- **`is_static=false` and empty `publish_directory`.** The app was configured
  as a static site; deploying the SSR image without flipping those first fails
  the build on `/app/dist`.
- Exposed port: **4321** (was 80 under nginx).
- Optional build ARG: `PUBLIC_REQUIREMENTS_ENDPOINT`.
- Source: `BroteaConnect/rafael-news`, branch `main`.

## URLs

Spanish is the default language and lives at `/`; English lives at `/en/`.
The old `/es/*` URLs are 301-redirected to their unprefixed equivalent by
`astro.config.mjs`, so indexed links keep working.

## Release process

Production deploys are triggered by the Brotea factory, not by hand: changes
reach `main` only through a PR that is auto-merged after green CI — green CI is
the only gate. After merge, the factory (re)deploys the Coolify application
from `main`.
