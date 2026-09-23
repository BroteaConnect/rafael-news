-- The YouTube video of a story.
--
-- One column on `stories`, not a row per language: a YouTube id is not
-- translatable text, so it lives where `topic_id` and `relevance` already live
-- and is written the same way from any language tab of the newsroom.
--
-- What is stored is the 11-character ID, never the pasted link: that value ends
-- up inside an iframe `src`, and an author-written string that reaches an
-- attribute is exactly what `markdown.ts` exists to prevent. The CHECK is the
-- second line of defence behind the parser, in the same spirit as
-- `stories_one_lead`.
--
-- Idempotent because it has to be: `migrate()` re-runs EVERY migration on every
-- boot and `schema_migrations` is bookkeeping, not a lock. `ADD COLUMN IF NOT
-- EXISTS` is idempotent out of the box; `ADD CONSTRAINT IF NOT EXISTS` DOES NOT
-- EXIST in Postgres, so the CHECK is wrapped in a block that swallows the
-- duplicate. Without it the second boot crashes the migration, `snapshot.init()`
-- eats the error and the portal quietly serves the seed as if nothing happened.

ALTER TABLE stories ADD COLUMN IF NOT EXISTS video_id text;

DO $$
BEGIN
  ALTER TABLE stories ADD CONSTRAINT stories_video_id_shape
    CHECK (video_id IS NULL OR video_id ~ '^[A-Za-z0-9_-]{11}$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

INSERT INTO schema_migrations (version) VALUES ('004_story_video')
  ON CONFLICT (version) DO NOTHING;
