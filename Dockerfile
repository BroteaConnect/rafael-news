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

# Un alta que no lleva a ninguna parte es el fallo silencioso de este portal, y
# esta comprobación ha ido cambiando con lo que había que garantizar cada vez:
#   1. que dist/index.html llevara el endpoint del formulario  (estático)
#   2. que el bundle de servidor llevara la URL del recolector  (SSR)
#   3. hoy: que la RUTA del alta exista dentro del bundle
# El alta ya no viaja a ningún tercero —escribe en nuestro Postgres—, así que
# exigir una URL externa era exigir algo que dejó de ser cierto: el gate se
# puso rojo por hacer bien su trabajo. Lo que sigue siendo verdad es que sin
# esta ruta el formulario de la portada no tiene con quién hablar.
RUN grep -rq 'api/newsletter' dist/server/

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
