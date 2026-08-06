-- Contenido editorial de Brotea News. Se aplica al arrancar y es idempotente:
-- el runtime no tiene consola ni nadie que lance migraciones a mano.
--
-- La forma sale de src/lib/content/types.ts, así que el contrato que ya usaban
-- las páginas en F1 no cambia — solo cambia de dónde salen los datos.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS authors (
  id          text PRIMARY KEY,
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,               -- un nombre propio no se traduce
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Los textos traducibles van en FILAS POR IDIOMA, no en una columna jsonb: en
-- la redacción (F5) se edita un idioma cada vez, y un jsonb convierte cada dos
-- ediciones simultáneas en una carrera que pisa la traducción del otro.
CREATE TABLE IF NOT EXISTS author_i18n (
  author_id  text NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  locale     text NOT NULL,
  role       text NOT NULL,
  bio        text NOT NULL,
  PRIMARY KEY (author_id, locale)
);

CREATE TABLE IF NOT EXISTS topics (
  id          text PRIMARY KEY,
  slug        text NOT NULL UNIQUE,
  sort_order  int  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS topic_i18n (
  topic_id  text NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  locale    text NOT NULL,
  name      text NOT NULL,
  PRIMARY KEY (topic_id, locale)
);

CREATE TABLE IF NOT EXISTS stories (
  id              text PRIMARY KEY,
  slug            text NOT NULL UNIQUE,
  topic_id        text NOT NULL REFERENCES topics(id),
  author_id       text NOT NULL REFERENCES authors(id),
  relevance       text NOT NULL CHECK (relevance IN ('high','medium','low')),
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','scheduled','published','archived')),
  published_at    timestamptz,
  reading_minutes int  NOT NULL DEFAULT 1 CHECK (reading_minutes > 0),
  lead            boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS story_i18n (
  story_id    text NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  locale      text NOT NULL,
  title       text NOT NULL,
  standfirst  text NOT NULL,
  body_md     text,
  -- Se guarda YA renderizado y saneado: renderizar en cada visita es trabajo
  -- repetido para un texto que cambia una vez, y saneando al guardar hay un
  -- único sitio por donde el HTML entra al sistema.
  body_html   text,
  PRIMARY KEY (story_id, locale)
);

-- La portada no tiene sitio para dos destacados. Que lo impida la base de
-- datos y no el buen criterio de quien publica.
CREATE UNIQUE INDEX IF NOT EXISTS stories_one_lead
  ON stories ((true)) WHERE lead AND status = 'published';

CREATE INDEX IF NOT EXISTS stories_published_idx
  ON stories (published_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS stories_topic_idx    ON stories (topic_id, published_at DESC);
CREATE INDEX IF NOT EXISTS stories_author_idx   ON stories (author_id, published_at DESC);

-- Versión del contenido: la instantánea en memoria se invalida comparando este
-- número, y el ETag de las páginas sale de aquí.
CREATE TABLE IF NOT EXISTS content_version (
  id       boolean PRIMARY KEY DEFAULT true CHECK (id),
  version  bigint  NOT NULL DEFAULT 1
);
INSERT INTO content_version (id, version) VALUES (true, 1) ON CONFLICT (id) DO NOTHING;

-- Publicar avisa. Sin esto la instantánea solo se enteraría al reiniciar, y
-- «publicado» dejaría de significar «visible».
CREATE OR REPLACE FUNCTION bump_content_version() RETURNS trigger AS $$
BEGIN
  UPDATE content_version SET version = version + 1 WHERE id;
  PERFORM pg_notify('contenido', (SELECT version::text FROM content_version WHERE id));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stories_bump    ON stories;
DROP TRIGGER IF EXISTS story_i18n_bump ON story_i18n;
DROP TRIGGER IF EXISTS authors_bump    ON authors;
DROP TRIGGER IF EXISTS author_i18n_bump ON author_i18n;
CREATE TRIGGER stories_bump     AFTER INSERT OR UPDATE OR DELETE ON stories
  FOR EACH STATEMENT EXECUTE FUNCTION bump_content_version();
CREATE TRIGGER story_i18n_bump  AFTER INSERT OR UPDATE OR DELETE ON story_i18n
  FOR EACH STATEMENT EXECUTE FUNCTION bump_content_version();
CREATE TRIGGER authors_bump     AFTER INSERT OR UPDATE OR DELETE ON authors
  FOR EACH STATEMENT EXECUTE FUNCTION bump_content_version();
CREATE TRIGGER author_i18n_bump AFTER INSERT OR UPDATE OR DELETE ON author_i18n
  FOR EACH STATEMENT EXECUTE FUNCTION bump_content_version();

INSERT INTO schema_migrations (version) VALUES ('001_content')
  ON CONFLICT (version) DO NOTHING;
