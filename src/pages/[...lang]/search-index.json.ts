import type { APIRoute } from 'astro';
import { getSearchIndex } from '../../lib/content/store';
import { resolveLocale } from '../../lib/route';

// El índice del buscador de la cabecera, un idioma por respuesta. Se cachea
// como el HTML, así que en F2 lo invalidará la misma versión de instantánea que
// publica una noticia: el alta aparece en el buscador a la vez que en portada.
export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const locale = resolveLocale(params.lang);
  if (!locale) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(await getSearchIndex(locale)), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=86400',
    },
  });
};
