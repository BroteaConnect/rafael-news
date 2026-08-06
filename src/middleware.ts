import type { MiddlewareHandler } from 'astro';
import { contentVersion, init } from './lib/content/snapshot';

// Dos cosas que tienen que pasar en TODAS las peticiones, y por eso están aquí
// y no repetidas en cada página:
//
// 1. Que la instantánea esté cargada. `init()` se memoiza, así que solo la
//    primera petición espera de verdad — y ni esa se queda colgada: si Postgres
//    no responde, `init()` no lanza y se sirve la semilla.
// 2. El ETag. Sale de la versión del contenido, así que un lector que vuelve
//    recibe 304 hasta que la redacción publica algo, sin que nadie tenga que
//    acordarse de invalidar nada.

const CACHEABLE = /^(?!\/api\/)(?!\/healthz).*/;

export const onRequest: MiddlewareHandler = async (context, next) => {
  await init();
  const response = await next();

  const path = context.url.pathname;
  if (context.request.method !== 'GET' || !CACHEABLE.test(path) || response.status !== 200) {
    return response;
  }

  // Débil, no fuerte: dos respuestas de la misma versión son equivalentes para
  // el lector aunque no sean byte a byte idénticas.
  const etag = `W/"v${contentVersion()}-${path}"`;
  if (context.request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  response.headers.set('ETag', etag);
  // `max-age=0` para el navegador y `s-maxage` para el proxy: la caché
  // compartida absorbe las visitas y el lector nunca ve una portada vieja más
  // de un minuto. `stale-while-revalidate` es lo que mantiene la web en pie
  // mientras el origen se reinicia.
  response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=86400');
  return response;
};
