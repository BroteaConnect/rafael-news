# rafael-news docs

Documentation for the rafael-news static Astro landing. Start with
[deployment.md](./deployment.md), which covers the multi-stage Dockerfile
(Node build + nginx runtime), the required `PUBLIC_REQUIREMENTS_ENDPOINT`
build ARG that wires the requirements form to its API at build time, the
Coolify configuration (dockerfile build pack, port 80), and how the Brotea
factory releases to production with green CI as the only gate.
