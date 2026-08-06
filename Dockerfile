# syntax=docker/dockerfile:1
# Tres etapas. La app dejó de ser un estático servido por nginx: ahora es un
# servidor node (adaptador standalone de Astro), así que el runtime necesita
# dependencias de producción — pero NO las de desarrollo, que son la mitad del
# peso (typescript, @astrojs/check).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Destino del alta al boletín. Astro incrusta las PUBLIC_* en el bundle al
# construir, así que tiene que estar presente ANTES de `npm run build`.
ARG PUBLIC_REQUIREMENTS_ENDPOINT
ENV PUBLIC_REQUIREMENTS_ENDPOINT=$PUBLIC_REQUIREMENTS_ENDPOINT

# Las PUBLIC_* se incrustan en el bundle en tiempo de build. El compositor
# cablea un par ARG/ENV por capacidad justo debajo de este ancla.
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

# Un build sin destino sirve un alta muerta: fallar pronto. Se comprueba el
# RESULTADO —que dentro del bundle de servidor viaja una URL absoluta de alta— y
# no la variable de entrada, porque desde que la ruta tiene default compilado
# exigir la variable rompía cualquier build fuera de Coolify. Antes esto miraba
# dist/index.html, que con el adaptador de node ya no existe.
RUN grep -rqE 'https://[a-z0-9.-]+/requirements' dist/server/

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# El adaptador escucha en localhost si no se le dice otra cosa, y dentro de un
# contenedor eso significa que NADIE puede hablarle desde fuera.
ENV HOST=0.0.0.0
ENV PORT=4321
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/dist ./dist
EXPOSE 4321
USER node
CMD ["node", "./dist/server/entry.mjs"]
