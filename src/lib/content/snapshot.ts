// La instantánea: TODO el contenido publicado, en memoria, congelado.
//
// Es la pieza que hace que el portal sea rápido sin ser estático. Una página
// no consulta Postgres: lee de aquí. La base de datos solo se toca al arrancar
// y cuando la redacción publica.
//
// Consecuencia que vale más que la velocidad: **si Postgres se cae, el portal
// sigue sirviendo**. Solo se bloquea publicar.
import { configured, listen, loadSnapshot, migrate } from './db';
import seedData from './seed.data.json';
import type { ContentSource } from './types';

const SEED = seedData as unknown as ContentSource;

let source: ContentSource = SEED;
let version = 0;
let ready: Promise<void> | null = null;

/** El contenido que se está sirviendo ahora mismo. Nunca es null: antes de
 *  hablar con la base de datos ya vale la semilla, así que el arranque en frío
 *  sirve la portada aunque Postgres no esté todavía. */
export const current = (): ContentSource => source;

/** Versión del contenido. Es lo que va en el ETag: cuando sube, el HTML
 *  cacheado deja de valer; mientras no suba, un 304 es correcto. */
export const contentVersion = (): number => version;

async function refresh(): Promise<void> {
  const next = await loadSnapshot();
  // Sin noticias publicadas no se pisa lo que hay: una consulta que devuelve
  // vacío por un fallo a medias dejaría la portada en blanco, y una portada
  // vieja es mucho mejor que ninguna.
  if (next.source.stories.length === 0) {
    console.warn('[contenido] la base de datos no devolvió noticias; se mantiene la instantánea anterior');
    return;
  }
  source = next.source;
  version = next.version;
  console.log(`[contenido] instantánea v${version}: ${source.stories.length} noticias`);
}

/**
 * Arranque. Se llama una sola vez y NUNCA lanza: un fallo de base de datos no
 * puede impedir que el portal sirva. Deja la semilla y lo dice en el log.
 */
export function init(): Promise<void> {
  ready ??= (async () => {
    if (!configured()) {
      console.log('[contenido] sin DATABASE_URL: se sirve la semilla');
      return;
    }
    try {
      await migrate();
      await refresh();
      await listen(() => { void refresh().catch((e) => console.error('[contenido] no se pudo refrescar:', e.message)); });
    } catch (e) {
      console.error('[contenido] arranque sin base de datos, se sirve la semilla:', (e as Error).message);
    }
  })();
  return ready;
}
