import type { MiddlewareHandler } from 'astro';
import { contentVersion, init } from './lib/content/snapshot';
import { CSRF_COOKIE, CSRF_FIELD, SESSION_COOKIE, csrfMatches, newCsrf } from './lib/auth/core';
import { configured as authConfigured, sessionFromToken } from './lib/auth/store';

// Lo que tiene que pasar en TODAS las peticiones, y por eso está aquí y no
// repetido —ni olvidado— en cada página:
//
// 1. Que la instantánea de contenido esté cargada. `init()` se memoiza, así que
//    solo la primera petición espera, y ni esa se cuelga: si Postgres no
//    responde no lanza, y se sirve la semilla.
// 2. La sesión de la redacción, y el guardián de /admin.
// 3. CSRF en todo POST.
// 4. El ETag de las páginas públicas.

const PUBLIC_CACHEABLE = /^(?!\/api\/)(?!\/healthz)(?!\/admin).*/;
const ADMIN = /^\/admin(\/|$)/;
// Las únicas rutas de /admin a las que se llega SIN sesión. Cualquier otra cosa
// bajo /admin exige haber entrado: la lista es blanca a propósito, porque una
// lista negra se olvida de la ruta nueva que alguien añada mañana.
const ADMIN_PUBLIC = /^\/admin\/(entrar|salir|aceptar|restablecer)(\/|$)/;

export const onRequest: MiddlewareHandler = async (context, next) => {
  await init();
  const path = context.url.pathname;
  const method = context.request.method;

  // -- sesión ------------------------------------------------------------------
  context.locals.user = null;
  const token = context.cookies.get(SESSION_COOKIE)?.value;
  if (token && authConfigured()) {
    try {
      context.locals.user = await sessionFromToken(token);
    } catch (e) {
      // Una base caída no puede convertir /admin en un 500 opaco: se trata como
      // «sin sesión» y el guardián manda a entrar.
      console.error('[auth] no se pudo leer la sesión:', (e as Error).message);
    }
  }

  // -- CSRF --------------------------------------------------------------------
  // Doble envío en TODO POST de formulario. `SameSite=Lax` solo no cubre un
  // POST desde un subdominio comprometido, y esto cuesta una comparación.
  //
  // El cuerpo se lee UNA vez y viaja en `locals`. `request.clone().formData()`
  // parecía lo natural, pero sobre un cuerpo en streaming con el adaptador de
  // node devuelve null en silencio: el `.catch()` se lo tragaba y TODO POST
  // acababa en 403 — con la cookie y el campo idénticos. Las páginas leen
  // `locals.form`, nunca `Astro.request.formData()`.
  context.locals.form = null;
  if (method === 'POST' && !path.startsWith('/api/')) {
    context.locals.form = await context.request.formData().catch(() => null);
    if (!csrfMatches(context.cookies.get(CSRF_COOKIE)?.value, context.locals.form?.get(CSRF_FIELD))) {
      return new Response('CSRF', { status: 403 });
    }
  }

  // -- guardián ----------------------------------------------------------------
  if (ADMIN.test(path) && !ADMIN_PUBLIC.test(path) && !context.locals.user) {
    return context.redirect('/admin/entrar', 302);
  }

  // Un token de CSRF por visitante, en cookie legible por el formulario. No es
  // secreto frente a quien ya está en la página: su valor está en que un tercero
  // no puede leerlo desde otro origen.
  if (ADMIN.test(path) && !context.cookies.get(CSRF_COOKIE)) {
    context.cookies.set(CSRF_COOKIE, newCsrf(), {
      path: '/', httpOnly: false, sameSite: 'lax', secure: import.meta.env.PROD, maxAge: 86400,
    });
  }

  const response = await next();

  // -- cabeceras ---------------------------------------------------------------
  if (ADMIN.test(path)) {
    // Ni cachés compartidas ni buscadores: lo de la redacción no se guarda en un
    // proxy ni aparece en un resultado de búsqueda.
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  }

  if (method !== 'GET' || !PUBLIC_CACHEABLE.test(path) || response.status !== 200) return response;

  // Débil, no fuerte: dos respuestas de la misma versión son equivalentes para
  // el lector aunque no sean byte a byte idénticas.
  const etag = `W/"v${contentVersion()}-${path}"`;
  if (context.request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  response.headers.set('ETag', etag);
  response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=86400');
  return response;
};
