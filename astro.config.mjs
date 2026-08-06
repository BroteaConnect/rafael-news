import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// Servidor, no estático: el portal publica varias veces al día, necesita
// borradores y previsualización, y a partir de F5 lleva sesiones de redacción.
// La velocidad no la da el HTML precocinado sino la instantánea en memoria
// (src/lib/content.ts): las páginas públicas se renderizan sin tocar la base
// de datos, así que el TTFB es CPU y nada más.
export default defineConfig({
  // hreflang exige URLs absolutas, y de aquí sale el origen canónico
  site: 'https://rafael-news.brotea.dev',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // El idioma por defecto pasa de `en` a `es`: lo que antes vivía en /es/*
  // ahora vive en la raíz. Sin estos 301 cada URL indexada da un 404.
  redirects: {
    '/es': '/',
    '/es/[...rest]': '/[...rest]',
  },
});
