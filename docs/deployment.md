# Deployment

Brotea News is a **server-rendered** Astro app (node adapter, standalone)
packaged as a Docker image and deployed to Coolify by the Brotea factory.
Until feature 57 it was a static site served by nginx; it is not any more.

## Docker image

The `Dockerfile` at the repo root has three stages:

1. **deps** — `node:22-alpine`, `npm ci --omit=dev`: the modules the server
   needs at runtime (`astro`, `@astrojs/node`, `pg`), without the dev half
   (typescript, `@astrojs/check`, `@types/pg`).
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

## Runtime env: `DATABASE_URL`

The Postgres connection string for the editorial content. **Runtime variable,
never a build ARG** — a credential is not baked into an image.

```bash
docker run -p 8080:4321 -e DATABASE_URL='postgres://…' rafael-news
```

What the app does with it, at boot only (never during a request):

| `DATABASE_URL` | Behaviour |
| --- | --- |
| unset | Logs `sin DATABASE_URL: se sirve la semilla` and serves the bundled seed. This is local dev and CI. |
| set, reachable | Applies the migrations, seeds the tables if `stories` is empty, loads the snapshot, `LISTEN contenido`. |
| set, unreachable | Logs the error and serves the seed anyway. The container still starts and `/healthz` still answers `200`. |

Once running, **the reader never waits for Postgres**: pages render from the
in-memory snapshot. A database restart is not a public incident — only
publishing stops until the connection comes back (the listener retries every
5s). See [architecture.md](./architecture.md#content-layer).

## Migrations

There is no migration command and no console in the runtime image. `migrate()`
in `src/lib/content/db.ts` runs every entry of its `MIGRATIONS` list at boot —
today just `['001_content']` — so **deploying is applying the migration**.

Every migration is re-executed on every boot, which is why each one *must* be
idempotent: `001_content.sql` uses `CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`,
`DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` and `INSERT … ON CONFLICT DO
NOTHING`, and records itself in `schema_migrations`. A new migration means a new
`.sql` file under `src/migrations/` **plus** its entry in `MIGRATIONS`; the file
alone does nothing.

The SQL is imported with `?raw` (`import migration001 from
'../../migrations/001_content.sql?raw'`), so it is bundled inside
`dist/server/`. The runtime stage only copies `dist/`, `package.json` and
`node_modules` — a loose `.sql` file in the repo would never reach the
container, and the migration would fail in production only.

On the first boot against an empty database, `seedIfEmpty()` inserts
`src/lib/content/seed.data.json` in a single transaction, so the deploy that
switched the source did not change a pixel of the home page.

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
- Runtime env var: `DATABASE_URL`, pointing at the app's Postgres service.
  Set it as a runtime variable, not a build one.
- Source: `BroteaConnect/rafael-news`, branch `main`.

## URLs

Spanish is the default language and lives at `/`; English lives at `/en/`.
The old `/es/*` URLs are 301-redirected to their unprefixed equivalent by
`astro.config.mjs`, so indexed links keep working.

`site: 'https://rafael-news.brotea.dev'` in `astro.config.mjs` is the canonical
origin: canonical tags, hreflang alternates, `/rss.xml` and `/sitemap.xml` all
build their absolute URLs from it. Both feeds are generated per request from the
content snapshot, so there is no build step or cron to keep them fresh.

Public HTML responses carry a weak `ETag` derived from the content version and
`Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=86400`
(`/healthz` and `/api/*` excluded). A shared cache in front of the app absorbs
traffic, keeps serving while the origin restarts, and stops serving stale HTML
within a minute of a publication.

## Release process

Production deploys are triggered by the Brotea factory, not by hand: changes
reach `main` only through a PR that is auto-merged after green CI — green CI is
the only gate. After merge, the factory (re)deploys the Coolify application
from `main`.
