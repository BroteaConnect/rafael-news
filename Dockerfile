# Stage 1: build the static Astro site
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build-time endpoint for the requirements form; Astro inlines PUBLIC_* vars
# at build time, so it must be present as an env var before `npm run build`.
ARG PUBLIC_REQUIREMENTS_ENDPOINT
ENV PUBLIC_REQUIREMENTS_ENDPOINT=${PUBLIC_REQUIREMENTS_ENDPOINT}

# brotea:build-args
ARG PUBLIC_BUILD_COMMIT
ENV PUBLIC_BUILD_COMMIT=$PUBLIC_BUILD_COMMIT
ARG PUBLIC_GLITCHTIP_DSN
ENV PUBLIC_GLITCHTIP_DSN=$PUBLIC_GLITCHTIP_DSN
ARG PUBLIC_UMAMI_WEBSITE_ID
ENV PUBLIC_UMAMI_WEBSITE_ID=$PUBLIC_UMAMI_WEBSITE_ID
ARG PUBLIC_UMAMI_SRC
ENV PUBLIC_UMAMI_SRC=$PUBLIC_UMAMI_SRC

RUN npm run build

# A build without the endpoint ships a permanently disabled form; fail fast.
RUN test -n "$PUBLIC_REQUIREMENTS_ENDPOINT" \
 && grep -qF "$PUBLIC_REQUIREMENTS_ENDPOINT" dist/index.html

# Stage 2: serve the built dist/ with nginx
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
