// Las noticias desde la redacción: leer para editar y escribir.
//
// Es la cara de escritura de las mismas tablas que lee la instantánea. Publicar
// dispara el trigger de contenido, la instantánea se refresca y la noticia
// aparece en la portada sin reconstruir ni reiniciar nada.
import pg from 'pg';
import { renderMarkdown, readingMinutes, slugify } from '../markdown';
import type { Relevance, TopicId } from '../content/types';

let pool: pg.Pool | null = null;
const db = (): pg.Pool => (pool ??= new pg.Pool({
  connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000,
}));

export type Status = 'draft' | 'scheduled' | 'published' | 'archived';

export interface StoryRow {
  id: string; slug: string; topicId: TopicId; authorId: string; authorName: string;
  relevance: Relevance; status: Status; publishedAt: string | null;
  readingMinutes: number; lead: boolean; updatedAt: string;
  title: string;
}

export interface StoryDraft {
  id: string; slug: string; topicId: TopicId; authorId: string;
  relevance: Relevance; status: Status; publishedAt: string | null; lead: boolean;
  i18n: Record<string, { title: string; standfirst: string; bodyMd: string }>;
}

/** El listado de la redacción: TODAS, no solo las publicadas — el sentido de
 *  esta pantalla son precisamente los borradores. */
export async function listStories(locale: string): Promise<StoryRow[]> {
  const { rows } = await db().query(
    `SELECT s.id, s.slug, s.topic_id, s.author_id, s.relevance, s.status, s.published_at,
            s.reading_minutes, s.lead, s.updated_at,
            COALESCE(a.name,'') AS author_name, COALESCE(i.title,'(sin título)') AS title
     FROM stories s
     LEFT JOIN authors a ON a.id = s.author_id
     LEFT JOIN story_i18n i ON i.story_id = s.id AND i.locale = $1
     ORDER BY COALESCE(s.published_at, s.updated_at) DESC`, [locale],
  );
  return rows.map((r) => ({
    id: r.id, slug: r.slug, topicId: r.topic_id, authorId: r.author_id,
    authorName: r.author_name, relevance: r.relevance, status: r.status,
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    readingMinutes: r.reading_minutes, lead: r.lead,
    updatedAt: new Date(r.updated_at).toISOString(), title: r.title,
  }));
}

export async function getDraft(id: string): Promise<StoryDraft | null> {
  const { rows } = await db().query(
    `SELECT id, slug, topic_id, author_id, relevance, status, published_at, lead
     FROM stories WHERE id = $1`, [id],
  );
  const s = rows[0];
  if (!s) return null;
  const { rows: i18n } = await db().query(
    'SELECT locale, title, standfirst, COALESCE(body_md, \'\') AS body_md FROM story_i18n WHERE story_id = $1', [id],
  );
  return {
    id: s.id, slug: s.slug, topicId: s.topic_id, authorId: s.author_id,
    relevance: s.relevance, status: s.status, lead: s.lead,
    publishedAt: s.published_at ? new Date(s.published_at).toISOString() : null,
    i18n: Object.fromEntries(i18n.map((r) => [r.locale, {
      title: r.title, standfirst: r.standfirst, bodyMd: r.body_md,
    }])),
  };
}

export async function createStory(authorId: string, topicId: TopicId): Promise<string> {
  // Un id legible y estable, con marca de tiempo: ordena solo y no depende de
  // que el titular no cambie (que cambia, y mucho, antes de publicar).
  const id = `st-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  await db().query(
    `INSERT INTO stories (id, slug, topic_id, author_id, relevance, status, reading_minutes)
     VALUES ($1, $1, $2, $3, 'medium', 'draft', 1)`, [id, topicId, authorId],
  );
  return id;
}

/**
 * Undo a createStory() whose saveStory() never landed. Deliberately narrow: it
 * deletes only a draft that carries no text in any language, which is a row no
 * reader and no editor ever wanted. Anything else is somebody's work and is left
 * exactly where it is, so this can never widen into a delete-story tool.
 */
export async function discardEmptyStory(id: string): Promise<void> {
  await db().query(
    `DELETE FROM stories WHERE id = $1 AND status = 'draft'
       AND NOT EXISTS (SELECT 1 FROM story_i18n WHERE story_id = $1)`, [id],
  );
}

export interface SaveInput {
  id: string; locale: string; title: string; standfirst: string; bodyMd: string;
  topicId: TopicId; relevance: Relevance;
}

/** Guarda un idioma de la noticia. El markdown se convierte AQUÍ y se guarda ya
 *  renderizado: un único sitio por el que entra HTML al sistema. */
export async function saveStory(input: SaveInput): Promise<void> {
  const bodyHtml = renderMarkdown(input.bodyMd);
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE stories SET topic_id = $2, relevance = $3, reading_minutes = $4, updated_at = now()
       WHERE id = $1`,
      [input.id, input.topicId, input.relevance, readingMinutes(input.bodyMd)],
    );
    await client.query(
      `INSERT INTO story_i18n (story_id, locale, title, standfirst, body_md, body_html)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (story_id, locale) DO UPDATE SET
         title = EXCLUDED.title, standfirst = EXCLUDED.standfirst,
         body_md = EXCLUDED.body_md, body_html = EXCLUDED.body_html`,
      [input.id, input.locale, input.title, input.standfirst, input.bodyMd, bodyHtml],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export type PublishResult = 'ok' | 'sin-titulo' | 'slug-repetido';

/**
 * Publicar. El slug se calcula del titular en el idioma por defecto y solo
 * entonces: mientras es borrador el titular cambia diez veces, y una URL que
 * cambia después de publicada es un enlace roto para quien la compartió.
 */
export async function publish(id: string, defaultLocale: string, lead: boolean): Promise<PublishResult> {
  const { rows } = await db().query(
    'SELECT title FROM story_i18n WHERE story_id = $1 AND locale = $2', [id, defaultLocale],
  );
  const title = rows[0]?.title?.trim();
  if (!title) return 'sin-titulo';

  const { rows: current } = await db().query('SELECT slug, status FROM stories WHERE id = $1', [id]);
  // Ya publicada: se respeta su slug. Republicar no puede mover la URL.
  const slug = current[0]?.status === 'published' ? current[0].slug : (slugify(title) || id);

  const { rows: clash } = await db().query(
    'SELECT 1 FROM stories WHERE slug = $1 AND id <> $2', [slug, id],
  );
  if (clash.length) return 'slug-repetido';

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    if (lead) {
      // Solo puede haber un destacado, y la base lo impone con un índice único
      // parcial: hay que apartar al anterior ANTES, o la transacción falla.
      await client.query("UPDATE stories SET lead = false WHERE lead AND status = 'published' AND id <> $1", [id]);
    }
    await client.query(
      `UPDATE stories SET status='published', slug=$2, lead=$3,
              published_at = COALESCE(published_at, now()), updated_at = now()
       WHERE id = $1`, [id, slug, lead],
    );
    await client.query('COMMIT');
    return 'ok';
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Despublicar: vuelve a borrador y desaparece de la web al instante. No borra
 *  nada — retirar una noticia y perderla son cosas distintas. */
export async function unpublish(id: string): Promise<void> {
  await db().query(
    "UPDATE stories SET status='draft', lead=false, updated_at=now() WHERE id=$1", [id],
  );
}
