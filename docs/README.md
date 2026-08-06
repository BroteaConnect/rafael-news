# rafael-news docs

Documentation for Brotea News, the server-rendered Astro portal.

- [architecture.md](./architecture.md) — the portal itself: route map in both
  languages (including `/rss.xml`, `/sitemap.xml` and the `/boletin/*` pages),
  the content layer (`src/lib/content/`: Postgres schema, in-memory snapshot,
  `LISTEN`-driven refresh, ETag), the accessor contract, the newsletter's
  double opt-in (`POST /api/newsletter`, `newsletter_subscribers`, token
  lifecycle, rate limits), copy vs editorial content, the section components,
  the theme and formatting rules, and where tests must live.
- [deployment.md](./deployment.md) — how it ships: the three-stage Dockerfile
  (node runtime, no nginx) and its `api/newsletter` build gate, the
  `DATABASE_URL` and SMTP runtime variables, the migrations applied at boot
  (`001_content`, `002_newsletter`), the `runtime` service contract in
  `brotea.json` that CI and Coolify both read, the Coolify configuration
  (dockerfile build pack, port 4321, `is_static=false`), the URL and caching
  scheme, and the release process with green CI as the only gate.
