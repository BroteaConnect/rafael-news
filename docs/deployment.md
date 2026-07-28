# Deployment

The rafael-news landing is a static Astro site packaged as a Docker image
(added in PR #1) and deployed to Coolify by the Brotea factory.

## Docker image

The `Dockerfile` at the repo root is multi-stage:

1. **Build** — `node:22-alpine` installs dependencies with `npm ci` and runs
   `npm run build`, producing the static site in `dist/`.
2. **Runtime** — `nginx:alpine` copies `dist/` into
   `/usr/share/nginx/html` and serves it on **port 80**.

`.dockerignore` keeps the build context minimal (excludes `node_modules`,
`dist`, `.git`, `.github`, `.astro`, `.env*`, logs, `README.md`, and the
Docker files themselves).

```bash
docker build \
  --build-arg PUBLIC_REQUIREMENTS_ENDPOINT=https://api.brotea.dev/requirements \
  -t rafael-news-landing .
docker run -p 8080:80 rafael-news-landing
```

## Required build ARG: `PUBLIC_REQUIREMENTS_ENDPOINT`

The landing's requirements form posts to the URL in
`PUBLIC_REQUIREMENTS_ENDPOINT`. Astro inlines `PUBLIC_*` variables **at
build time**, so the value must be present as an env var before
`npm run build` — it cannot be injected at container runtime. The
Dockerfile declares it as a build `ARG` and exports it as `ENV` for the
build step.

The build **fails fast** if the ARG is missing or was not inlined: after
`npm run build` it asserts the variable is non-empty and that its value
appears in `dist/index.html`:

```dockerfile
RUN test -n "$PUBLIC_REQUIREMENTS_ENDPOINT" \
 && grep -qF "$PUBLIC_REQUIREMENTS_ENDPOINT" dist/index.html
```

Without this, a green build would ship a permanently disabled form
("Submissions are not enabled yet."). The production value is
`https://api.brotea.dev/requirements`; the receiving API (CORS, spam
handling) lives outside this repo.

## Coolify setup

- Build pack: `dockerfile` (nixpacks cannot serve a static Astro site — no
  start command — and crash-loops with 503).
- Build ARG: `PUBLIC_REQUIREMENTS_ENDPOINT=https://api.brotea.dev/requirements`.
- Exposed port: **80** (nginx).
- Source: `BroteaConnect/rafael-news`, branch `main`.

## Release process

Production deploys are triggered by the Brotea factory, not by hand:
changes reach `main` only through a PR that is auto-merged after green CI —
green CI is the only gate. After merge, the factory (re)deploys the Coolify
application from `main` and considers the deploy done only when Coolify
reports `finished`.
