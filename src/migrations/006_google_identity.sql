-- Google sign-in: the identity a newsroom account may also be opened with.
--
-- Numbered 006 and not 004: 004_story_video.sql belongs to the story-video
-- feature, branched before 005. The numbers are bookkeeping for humans; the
-- version string is what schema_migrations stores.
--
-- A column and not an identities table: one provider, at most one Google
-- account per user, and the join is read on every callback. Nullable because
-- linking happens on the first Google sign-in, never at invite time. Google
-- never creates a user: the row must already exist and be `active`, which is
-- exactly the invariant 003_auth states ("no path that lets the first owner be
-- created without already being inside").
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_linked_at timestamptz;

-- Partial unique index: many NULLs, never two users behind one Google account.
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_idx
  ON users (google_sub) WHERE google_sub IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('006_google_identity')
  ON CONFLICT (version) DO NOTHING;
