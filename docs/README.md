# rafael-news docs

Documentation for Brotea News, the server-rendered Astro portal. Start with
[deployment.md](./deployment.md), which covers the three-stage Dockerfile (node
runtime, no nginx), the `runtime` service contract in `brotea.json` that CI and
Coolify both read, the `PUBLIC_REQUIREMENTS_ENDPOINT` build ARG behind the
newsletter intake, the Coolify configuration (dockerfile build pack, port 4321,
`is_static=false`), and how the Brotea factory releases to production with green
CI as the only gate.
