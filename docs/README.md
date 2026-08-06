# rafael-news docs

Documentation for Brotea News, the server-rendered Astro portal.

- [architecture.md](./architecture.md) — the portal itself: route map in both
  languages plus the unlocalised `/admin` routes (including `/rss.xml`,
  `/sitemap.xml` and the `/boletin/*` pages), the content layer
  (`src/lib/content/`: Postgres schema, in-memory snapshot, `LISTEN`-driven
  refresh, ETag), the accessor contract, the newsletter's double opt-in
  (`POST /api/newsletter`, `newsletter_subscribers`, token lifecycle, rate
  limits), the shared SMTP transport, the newsroom access layer (middleware
  guard, opaque DB sessions, CSRF double submit, scrypt and its `maxmem`
  caveat, invitations, roles, audit log, the `003_auth` tables and what is not
  implemented yet), copy vs editorial content, the section components, the theme
  and formatting rules, and where tests must live.
- [deployment.md](./deployment.md) — how it ships: the three-stage Dockerfile
  (node runtime, no nginx) and its `api/newsletter` build gate, the
  `DATABASE_URL` and SMTP runtime variables (the newsroom adds none), the
  migrations applied at boot (`001_content`, `002_newsletter`, `003_auth`), the
  first-owner bootstrap, the `runtime` service contract in `brotea.json` that CI
  and Coolify both read, the Coolify configuration (dockerfile build pack, port
  4321, `is_static=false`), the URL and caching scheme — `no-store` for
  `/admin` — and the release process with green CI as the only gate.
- [redaccion.md](./redaccion.md) — the newsroom for the people who use it: how
  access works (invitation only), what each role can do, the shell snippet that
  bootstraps the first owner, and what protects what (opaque revocable
  sessions, scrypt, CSRF, generic errors, audit log).
