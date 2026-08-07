# rafael-news docs

Documentation for Brotea News, the server-rendered Astro portal.

- [architecture.md](./architecture.md) — the portal itself: route map in both
  languages (including `/rss.xml`, `/sitemap.xml`, the `/boletin/*` pages and the
  newsroom's `/admin/noticias` routes), the content layer
  (`src/lib/content/`: Postgres schema, in-memory snapshot, `LISTEN`-driven
  refresh, ETag), the accessor contract, the newsroom write path
  (`src/lib/newsroom/store.ts`, the story-level permission check, slug at
  publish time, the single lead, and `src/lib/markdown.ts`: escape-first
  rendering into `body_html`, the allowed subset and the link-scheme filter), the
  newsletter's double opt-in (`POST /api/newsletter`, `newsletter_subscribers`,
  token lifecycle, rate limits), copy vs editorial content, the section
  components, the theme and formatting rules, and where tests must live.
- [redaccion.md](./redaccion.md) *(in Spanish)* — the newsroom as its people use
  it: invitation-only access, what each role can do, writing and previewing a
  story in Markdown one language at a time, publishing, marking the lead and
  pulling a story off the site, plus the first-owner bootstrap and what the
  session, CSRF and password design protect.
- [deployment.md](./deployment.md) — how it ships: the three-stage Dockerfile
  (node runtime, no nginx) and its `api/newsletter` build gate, the
  `DATABASE_URL` and SMTP runtime variables, the migrations applied at boot
  (`001_content`, `002_newsletter`), the `runtime` service contract in
  `brotea.json` that CI and Coolify both read, the Coolify configuration
  (dockerfile build pack, port 4321, `is_static=false`), the URL and caching
  scheme, and the release process with its two required workflows.
- [gate-web.md](./gate-web.md) *(in Spanish)* — `npm run gate:web`, the speed and
  accessibility gate that fails a PR from its own workflow
  (`.github/workflows/calidad-web.yml`): it boots the built server without
  `DATABASE_URL` and asks it over HTTP for the gzipped HTML/JS/CSS weight of four
  pages against fixed budgets, `s-maxage` + `ETag` on public pages, `no-store` +
  `noindex` on `/admin`, no `ETag` on `/healthz`, one `h1` with no heading-level
  skips, `alt` on images, a label on every control, and that the home page
  references nothing from `/admin` — plus what it deliberately does not measure
  (LCP, CLS, anything needing a real browser).
