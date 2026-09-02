// Postgres: migración, carga de la instantánea y aviso de publicación.
//
// Nada de esto está en el camino de una petición. Se ejecuta al arrancar y
// cuando la redacción publica; lo que sirve al lector es siempre la
// instantánea en memoria (snapshot.ts). Por eso una caída de Postgres deja
// la web funcionando y solo bloquea publicar.
import pg from 'pg';
// `?raw` para que Vite meta el SQL DENTRO del bundle del servidor: la imagen de
// producción solo copia dist/, así que un fichero suelto en el repo no llegaría
// y la migración fallaría solo en producción, que es donde peor se descubre.
import migration001 from '../../migrations/001_content.sql?raw';
import migration002 from '../../migrations/002_newsletter.sql?raw';
import migration003 from '../../migrations/003_auth.sql?raw';
import migration004 from '../../migrations/004_story_video.sql?raw';
import seedData from './seed.data.json';
import type { ContentSource, Localized, Story, TopicId } from './types';

const MIGRATIONS: ReadonlyArray<readonly [string, string]> = [
  ['001_content', migration001],
  ['002_newsletter', migration002],
  ['003_auth', migration003],
  ['004_story_video', migration004],
];

let pool: pg.Pool | null = null;

/** Sin DATABASE_URL no hay base de datos y no es un error: en local y en los
 *  tests el portal funciona con la semilla. */
export const configured = (): boolean => Boolean(process.env.DATABASE_URL);

function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      // Un Postgres que no contesta no puede dejar colgada la publicación.
      connectionTimeoutMillis: 5000,
      idle_in_transaction_session_timeout: 10000,
    });
    // Un error del pool sin oyente tumba el proceso entero: el portal se caería
    // por una desconexión de la base de datos que no debería afectarle.
    pool.on('error', (err) => console.error('[db] error en el pool:', err.message));
  }
  return pool;
}

/** Aplica lo que falte. Idempotente: el runtime no tiene consola ni nadie que
 *  lance migraciones a mano. */
export async function migrate(): Promise<void> {
  const db = getPool();
  for (const [version, sql] of MIGRATIONS) {
    await db.query(sql);
    console.log(`[db] migración ${version} aplicada`);
  }
  await seedIfEmpty();
}

/** Carga inicial. La semilla es la MISMA que servía F1, así que el día del
 *  cambio de fuente la portada no se mueve ni un pixel. */
async function seedIfEmpty(): Promise<void> {
  const db = getPool();
  const { rows } = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM stories');
  if (Number(rows[0]?.n ?? 0) > 0) return;

  const source = seedData as unknown as ContentSource;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const a of source.authors) {
      await client.query('INSERT INTO authors (id, slug, name) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING',
        [a.id, a.slug, a.name]);
      for (const locale of Object.keys(a.role)) {
        await client.query(
          `INSERT INTO author_i18n (author_id, locale, role, bio) VALUES ($1,$2,$3,$4)
           ON CONFLICT (author_id, locale) DO NOTHING`,
          [a.id, locale, a.role[locale], a.bio[locale]]);
      }
    }
    for (const [i, t] of source.topics.entries()) {
      await client.query('INSERT INTO topics (id, slug, sort_order) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING',
        [t.id, t.slug, i]);
      for (const locale of Object.keys(t.name)) {
        await client.query(
          'INSERT INTO topic_i18n (topic_id, locale, name) VALUES ($1,$2,$3) ON CONFLICT (topic_id, locale) DO NOTHING',
          [t.id, locale, t.name[locale]]);
      }
    }
    for (const s of source.stories) {
      await client.query(
        `INSERT INTO stories (id, slug, topic_id, author_id, relevance, status, published_at, reading_minutes, lead, video_id)
         VALUES ($1,$2,$3,$4,$5,'published',$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.slug, s.topicId, s.authorId, s.relevance, s.publishedAt, s.readingMinutes, s.lead,
          s.videoId ?? null]);
      for (const locale of Object.keys(s.title)) {
        // Sin cuerpo a propósito: inventar el análisis de un mercado y firmarlo
        // con el nombre de un analista real sería publicar algo falso. El cuerpo
        // lo escribe la redacción (F6); hasta entonces la página lo dice.
        await client.query(
          `INSERT INTO story_i18n (story_id, locale, title, standfirst) VALUES ($1,$2,$3,$4)
           ON CONFLICT (story_id, locale) DO NOTHING`,
          [s.id, locale, s.title[locale], s.standfirst[locale]]);
      }
    }
    await client.query('COMMIT');
    console.log(`[db] semilla cargada: ${source.stories.length} noticias`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

const groupByLocale = <T extends { locale: string }>(rows: T[], pick: (r: T) => string): Localized => {
  const out: Record<string, string> = {};
  for (const r of rows) out[r.locale] = pick(r);
  return out as Localized;
};

/** Lee TODO el contenido publicado. Con 3-5 noticias al día son unos pocos MB
 *  al año: cabe entero en memoria, que es lo que hace innecesario consultar
 *  la base de datos al servir una página. */
export async function loadSnapshot(): Promise<{ source: ContentSource; version: number }> {
  const db = getPool();
  const [authors, authorI18n, topics, topicI18n, stories, storyI18n, version] = await Promise.all([
    db.query('SELECT id, slug, name FROM authors ORDER BY id'),
    db.query('SELECT author_id, locale, role, bio FROM author_i18n'),
    db.query('SELECT id, slug FROM topics ORDER BY sort_order, id'),
    db.query('SELECT topic_id, locale, name FROM topic_i18n'),
    db.query(`SELECT id, slug, topic_id, author_id, relevance, published_at, reading_minutes, lead, video_id
              FROM stories WHERE status='published' AND published_at <= now()
              ORDER BY published_at DESC`),
    db.query('SELECT story_id, locale, title, standfirst, body_html FROM story_i18n'),
    db.query('SELECT version FROM content_version WHERE id'),
  ]);

  const source: ContentSource = {
    authors: authors.rows.map((a) => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      role: groupByLocale(authorI18n.rows.filter((r) => r.author_id === a.id), (r) => r.role),
      bio: groupByLocale(authorI18n.rows.filter((r) => r.author_id === a.id), (r) => r.bio),
    })),
    topics: topics.rows.map((t) => ({
      id: t.id as TopicId,
      slug: t.slug,
      name: groupByLocale(topicI18n.rows.filter((r) => r.topic_id === t.id), (r) => r.name),
    })),
    stories: stories.rows.map((s): Story => {
      const i18n = storyI18n.rows.filter((r) => r.story_id === s.id);
      return {
        id: s.id,
        slug: s.slug,
        topicId: s.topic_id as TopicId,
        authorId: s.author_id,
        relevance: s.relevance,
        publishedAt: new Date(s.published_at).toISOString(),
        readingMinutes: s.reading_minutes,
        lead: s.lead,
        videoId: s.video_id ?? undefined,
        title: groupByLocale(i18n, (r) => r.title),
        standfirst: groupByLocale(i18n, (r) => r.standfirst),
        body: groupByLocale(i18n, (r) => r.body_html ?? ''),
      };
    }),
    // El mercado todavía no vive en la base de datos: llega con el proveedor
    // real en F3, y hasta entonces sigue siendo la instantánea de muestra.
    market: (seedData as unknown as ContentSource).market,
  };
  return { source, version: Number(version.rows[0]?.version ?? 0) };
}

/**
 * Escucha las publicaciones. Conexión DEDICADA y fuera del pool: una que hace
 * LISTEN se queda ocupada para siempre, y si sale del pool acaba estrangulando
 * al resto de consultas.
 */
export async function listen(onBump: () => void): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  client.on('error', (err) => {
    console.error('[db] se cayó la escucha, se reintenta en 5s:', err.message);
    setTimeout(() => void listen(onBump), 5000);
  });
  await client.connect();
  await client.query('LISTEN contenido');
  client.on('notification', () => onBump());
  console.log('[db] escuchando publicaciones');
}
