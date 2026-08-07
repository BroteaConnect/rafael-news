# Deployment

Brotea News is a **server-rendered** Astro app (node adapter, standalone)
packaged as a Docker image and deployed to Coolify by the Brotea factory.
Until feature 57 it was a static site served by nginx; it is not any more.

## Docker image

The `Dockerfile` at the repo root has three stages:

1. **deps** — `node:22-alpine`, `npm ci --omit=dev`: the modules the server
   needs at runtime (`astro`, `@astrojs/node`, `pg`, `nodemailer`), without the
   dev half (typescript, `@astrojs/check`, `@types/pg`).
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

The Postgres connection string, used by the editorial content **and** by the
newsletter. **Runtime variable, never a build ARG** — a credential is not baked
into an image.

```bash
docker run -p 8080:4321 -e DATABASE_URL='postgres://…' rafael-news
```

What the app does with it, at boot only (never during a request):

| `DATABASE_URL` | Behaviour |
| --- | --- |
| unset | Logs `sin DATABASE_URL: se sirve la semilla` and serves the bundled seed. This is local dev and CI. |
| set, reachable | Applies the migrations, seeds the tables if `stories` is empty, loads the snapshot, `LISTEN contenido`. |
| set, unreachable | Logs the error and serves the seed anyway. The container still starts and `/healthz` still answers `200`. |

Once running, **the reader never waits for Postgres to read**: pages render from
the in-memory snapshot. A database restart is not a public incident — only
publishing stops until the connection comes back (the listener retries every
5s). See [architecture.md](./architecture.md#content-layer).

The newsletter is the one part that does need the database live: without
`DATABASE_URL` `POST /api/newsletter` answers `503` and logs it, because there
is nowhere to record a subscription and no seed to pretend with.

## Migrations

There is no migration command and no console in the runtime image. `migrate()`
in `src/lib/content/db.ts` runs every entry of its `MIGRATIONS` list at boot —
today `['001_content', '002_newsletter']` — so **deploying is applying the
migration**. `002_newsletter.sql` creates the `newsletter_subscribers` table and
its indexes, and needs `CREATE EXTENSION IF NOT EXISTS citext`: the database
role must be allowed to create the extension, or the boot log shows the
migration failing.

Every migration is re-executed on every boot, which is why each one *must* be
idempotent: they use `CREATE TABLE IF NOT EXISTS`, `CREATE EXTENSION IF NOT
EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`,
`DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` and `INSERT … ON CONFLICT DO
NOTHING`, and record themselves in `schema_migrations`. A new migration means a
new `.sql` file under `src/migrations/` **plus** its entry in `MIGRATIONS`; the
file alone does nothing.

The SQL is imported with `?raw` (`import migration002 from
'../../migrations/002_newsletter.sql?raw'`), so it is bundled inside
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

## Runtime env: SMTP

The confirmation email goes out over SMTP — not a REST API: Brevo's REST
endpoint answers `401` from unlisted IPs while SMTP keeps working. These are
**runtime** variables, never build ARGs.

| Variable | Required | Default | Used for |
| --- | --- | --- | --- |
| `SMTP_HOST` | yes | — | SMTP server |
| `SMTP_USER` | yes | — | SMTP user |
| `SMTP_PASS` | yes | — | SMTP password |
| `SMTP_PORT` | no | `587` | Port. `465` switches the transport to implicit TLS (`secure: true`); anything else uses STARTTLS |
| `MAIL_FROM` | no | `no-reply@brotea.dev` | `From:` of the confirmation email |

`src/lib/newsletter/mail.ts` considers mail configured only when `SMTP_HOST`,
`SMTP_USER` and `SMTP_PASS` are all set. **If they are not, nothing breaks
loudly**: the signup row is still written, the API still answers `202`, and the
log carries `[boletin] SMTP sin configurar: no se envía la confirmación` — the
subscriber simply stays `pending` for ever. Same for a send that fails: logged,
never thrown.

```bash
docker run -p 8080:4321 \
  -e DATABASE_URL='postgres://…' \
  -e SMTP_HOST='smtp-relay.example.com' -e SMTP_USER='…' -e SMTP_PASS='…' \
  -e MAIL_FROM='boletin@rafael-news.brotea.dev' \
  rafael-news
```

No variable carries the confirmation link's base URL: it comes from `site` in
`astro.config.mjs`, falling back to the request's own origin.

`PUBLIC_REQUIREMENTS_ENDPOINT` is **gone**. The signup no longer travels to any
third party, so requiring an external URL in the bundle was requiring something
that had stopped being true. The build gate still checks that the front-page
form has something to talk to, but now checks the route itself:

```dockerfile
RUN grep -rq 'api/newsletter' dist/server/
```

## Coolify setup

- Build pack: `dockerfile`.
- **`is_static=false` and empty `publish_directory`.** The app was configured
  as a static site; deploying the SSR image without flipping those first fails
  the build on `/app/dist`.
- Exposed port: **4321** (was 80 under nginx).
- Runtime env vars, never build ones: `DATABASE_URL` pointing at the app's
  Postgres service, plus `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` (and
  optionally `SMTP_PORT`, `MAIL_FROM`) for the newsletter's confirmation email.
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
reach `main` only through a PR that is auto-merged after green CI — CI is the
only gate. After merge, the factory (re)deploys the Coolify application from
`main`.

**Two workflows must be green, not one:**

| Workflow | Runs | Owner |
| --- | --- | --- |
| `.github/workflows/ci.yml` | `npm test` (locale/content tests, `astro check`, build) and the docker job that builds the real image and curls its [service contract](#service-contract) | the factory catalog — **generated**, never edit here |
| `.github/workflows/calidad-web.yml` | `npm ci` → `npm run build` → `npm run gate:web`: page weight budgets, cache headers and structural accessibility against the real built server ([gate-web.md](./gate-web.md)) | this repo |

The gate lives in its own file precisely because `ci.yml` is materialised by
`brotea quality sync`: steps added there would disappear on the next fleet
migration, and the gate would stop running without anyone noticing. Both
workflows trigger on `pull_request` and on `push` to `main`.
