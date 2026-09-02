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

The Postgres connection string, used by the editorial content, by the newsletter
**and** by the newsroom (`/admin`). **Runtime variable, never a build ARG** — a
credential is not baked into an image.

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

The newsletter and the newsroom are the parts that do need the database live:

- without `DATABASE_URL`, `POST /api/newsletter` answers `503` and logs it,
  because there is nowhere to record a subscription and no seed to pretend with;
- without it, `/admin/entrar` shows `admin.entrar.sin-base` and nobody can sign
  in — there are no users, no sessions and no local fallback for either. The
  public site keeps serving normally.
- if the database is set but momentarily unreachable, an existing session cannot
  be resolved: the middleware logs `[auth] no se pudo leer la sesión` and treats
  the request as signed out (a `302` to `/admin/entrar`), never a `500`.
- without it, `POST /api/mcp` answers `503` (`-32002`) to any request that
  carries a key, because there is nothing to verify the key against — a request
  with no bearer still gets its `401`. See [mcp.md](./mcp.md#degraded-modes).

## Migrations

There is no migration command and no console in the runtime image. `migrate()`
in `src/lib/content/db.ts` runs every entry of its `MIGRATIONS` list at boot —
today `['001_content', '002_newsletter', '003_auth', '005_mcp_tokens']` — so
**deploying is applying the migration**. `002_newsletter.sql` creates the
`newsletter_subscribers` table and its indexes, and needs `CREATE EXTENSION IF
NOT EXISTS citext`: the database role must be allowed to create the extension,
or the boot log shows the migration failing.

`003_auth.sql` (feature 60) adds the newsroom's tables — `users`, `invites`,
`sessions`, `password_resets`, `audit_log` — and reuses `citext` for the email
columns, so it depends on `002_newsletter` having created the extension and on
`001_content` having created `authors` (`users.author_id` references it).
It creates **no user and no way to create the first one**: see
[the first owner](#first-owner-bootstrap).

`005_mcp_tokens.sql` (feature 67) adds `mcp_tokens`, the keys a Claude client
authenticates with against `POST /api/mcp` (see [mcp.md](./mcp.md)). It depends
on `003_auth` having created `users`, which it references with
`ON DELETE CASCADE`. It is numbered `005` because `004` belongs to the
story-video feature; the number is bookkeeping for humans, the version string is
what `schema_migrations` stores. There is **no new environment variable**: like
sessions, the keys derive everything from the database and `node:crypto`.

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

Every email — the newsletter confirmation and the newsroom's invitations — goes
out over SMTP, not a REST API: Brevo's REST endpoint answers `401` from unlisted
IPs while SMTP keeps working. These are **runtime** variables, never build ARGs.

| Variable | Required | Default | Used for |
| --- | --- | --- | --- |
| `SMTP_HOST` | yes | — | SMTP server |
| `SMTP_USER` | yes | — | SMTP user |
| `SMTP_PASS` | yes | — | SMTP password |
| `SMTP_PORT` | no | `587` | Port. `465` switches the transport to implicit TLS (`secure: true`); anything else uses STARTTLS |
| `MAIL_FROM` | no | `no-reply@brotea.dev` | `From:` of every outgoing email |

Since feature 60 they are read in exactly one place,
`src/lib/mail/transport.ts`, which both `newsletter/mail.ts` and `auth/mail.ts`
send through — one SMTP configuration for the whole app. Mail counts as
configured only when `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` are all set.

**If they are not, nothing breaks loudly**: the transport logs `[correo] SMTP
sin configurar: no se envía "<subject>"` and returns `false`.

| Sender | Consequence of a failed or skipped send |
| --- | --- |
| Newsletter confirmation | The signup row is still written, the API still answers `202`, and the subscriber stays `pending` for ever |
| Newsroom invitation | The invite row still exists (72 h, unused); the page tells the owner it did not go out (`admin.invitar.sin-correo`) so they can resend, or the link can be handed over by another channel |

Same for a send that fails: logged, never thrown.

There are **no new environment variables** for the newsroom, nor for the MCP
server. Sessions, invitations, password hashing and MCP keys derive everything
from the database and `node:crypto` — there is no signing secret to set or
rotate. The one behaviour
tied to the build is the `Secure` flag on the session and CSRF cookies, which
comes from `import.meta.env.PROD`: the Docker image is a production build, so
the flag is on in every deployed environment and off in `npm run dev`.

```bash
docker run -p 8080:4321 \
  -e DATABASE_URL='postgres://…' \
  -e SMTP_HOST='smtp-relay.example.com' -e SMTP_USER='…' -e SMTP_PASS='…' \
  -e MAIL_FROM='boletin@rafael-news.brotea.dev' \
  rafael-news
```

No variable carries the base URL of the links in those emails — confirmation,
unsubscribe or invitation: they all come from `site` in `astro.config.mjs`,
falling back to the request's own origin.

`PUBLIC_REQUIREMENTS_ENDPOINT` is **gone**. The signup no longer travels to any
third party, so requiring an external URL in the bundle was requiring something
that had stopped being true. The build gate still checks that the front-page
form has something to talk to, but now checks the route itself:

```dockerfile
RUN grep -rq 'api/newsletter' dist/server/
```

## First owner bootstrap

A fresh database has **no users**, and there is no route that creates one
without an invitation — "if there are no users, the first one becomes owner" is
a classic vulnerability (whoever arrives first wins). After the first deploy
that applies `003_auth`, the first owner is created by inserting an invitation
directly in the database, an action that already requires server access:

```bash
TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
HASH=$(node -e "console.log(require('crypto').createHash('sha256').update('$TOKEN').digest('hex'))")
psql "$DATABASE_URL" -c "INSERT INTO invites (email, role, token_hash, expires_at)
  VALUES ('who.runs.it@example.com', 'owner', '$HASH', now() + interval '72 hours')"
echo "https://rafael-news.brotea.dev/admin/aceptar?t=$TOKEN"
```

The full procedure, including what to do afterwards, is in
[redaccion.md](./redaccion.md#the-first-owner-bootstrap). Nothing in the deploy
pipeline runs it: it is a one-off, per environment.

## Coolify setup

- Build pack: `dockerfile`.
- **`is_static=false` and empty `publish_directory`.** The app was configured
  as a static site; deploying the SSR image without flipping those first fails
  the build on `/app/dist`.
- Exposed port: **4321** (was 80 under nginx).
- Runtime env vars, never build ones: `DATABASE_URL` pointing at the app's
  Postgres service, plus `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` (and
  optionally `SMTP_PORT`, `MAIL_FROM`) for the newsletter's confirmation email
  and the newsroom's invitations. Nothing else: the newsroom adds no variables.
- Source: `BroteaConnect/rafael-news`, branch `main`.

## URLs

Spanish is the default language and lives at `/`; English lives at `/en/`.
The old `/es/*` URLs are 301-redirected to their unprefixed equivalent by
`astro.config.mjs`, so indexed links keep working.

`site: 'https://rafael-news.brotea.dev'` in `astro.config.mjs` is the canonical
origin: canonical tags, hreflang alternates, `/rss.xml` and `/sitemap.xml` all
build their absolute URLs from it. Both feeds are generated per request from the
content snapshot, so there is no build step or cron to keep them fresh.

`/admin/*` is the newsroom, unprefixed and single-language, and it is excluded
from all of that: `Cache-Control: no-store` plus `X-Robots-Tag: noindex,
nofollow` on every response, so it never lands in a shared cache or a search
result. A CDN or proxy in front of the app must not be configured to cache it.

Public HTML responses carry a weak `ETag` derived from the content version and
`Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=86400`
(`/healthz`, `/api/*` and `/admin/*` excluded). A shared cache in front of the app absorbs
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
