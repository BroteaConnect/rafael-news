# rafael-news docs

Documentation for Brotea News, the server-rendered Astro portal.

- [architecture.md](./architecture.md) — the portal itself: route map in both
  languages (including `/rss.xml` and `/sitemap.xml`), the content layer
  (`src/lib/content/`: Postgres schema, in-memory snapshot, `LISTEN`-driven
  refresh, ETag), the accessor contract, copy vs editorial content, the section
  components, the theme and formatting rules, and where tests must live.
- [deployment.md](./deployment.md) — how it ships: the three-stage Dockerfile
  (node runtime, no nginx), the `DATABASE_URL` runtime variable and the
  migrations applied at boot, the `runtime` service contract in `brotea.json`
  that CI and Coolify both read, the `PUBLIC_REQUIREMENTS_ENDPOINT` build ARG
  behind the newsletter intake, the Coolify configuration (dockerfile build
  pack, port 4321, `is_static=false`), the URL and caching scheme, and the
  release process with green CI as the only gate.
