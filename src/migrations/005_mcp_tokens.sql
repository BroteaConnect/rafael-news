-- MCP access keys: how a Claude client authenticates against /api/mcp.
--
-- Numbered 005 and not 004: 004_story_video.sql belongs to the story-video
-- feature, which was branched before this one. The numbers are bookkeeping for
-- humans — the version strings are what schema_migrations stores — but a
-- numbering that lies is worse than no numbering at all.
--
-- Its own table, and NOT the sessions one, even though the crypto is the same.
-- Three reasons, by weight:
--   1. A session token is the browser's key to the WHOLE newsroom. Handing that
--      same string to a desktop client, to a config file and to a process that
--      sends it over the internet turns one leak into full entry.
--   2. A session slides 30 days and dies on a password reset. A connector that
--      stops working because someone changed their password, or that a bot
--      keeps alive forever, has the wrong lifetime.
--   3. Scopes. The role says what a PERSON may do; this says what THIS KEY may
--      do, and it can be strictly less: an owner's key can be read-only.
--
-- Only the sha256 is stored, as in sessions, invites and the newsletter: the
-- clear token exists once, on the screen that created it.

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Whose it is. A key always acts as a person: what it writes is signed by
  -- their author record and audited with their id.
  user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- What its creator called it ("claude desktop, laptop"). Without a name, a
  -- list of four hashes cannot be revoked with any confidence.
  name          text   NOT NULL CHECK (btrim(name) <> ''),
  token_hash    text   NOT NULL UNIQUE,   -- the clear token never comes back
  -- text[] and not a comma-separated string: pg returns it as a JS array with
  -- no parsing, and `<@` makes it IMPOSSIBLE to store a scope that does not
  -- exist — the same call by which role and status are CHECKs in 003_auth.
  scopes        text[] NOT NULL DEFAULT ARRAY['content:read']::text[],
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- NULL = never expires, like the newsletter's token_expires_at. The page
  -- proposes 90 days; the primary control is revocation, not the clock.
  expires_at    timestamptz,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  CONSTRAINT mcp_tokens_scopes_known
    CHECK (scopes <@ ARRAY['content:read','stories:write']::text[]),
  CONSTRAINT mcp_tokens_scopes_present
    CHECK (array_length(scopes, 1) >= 1)
);

-- Only a person's live keys are ever listed; the hash already has its index by
-- being UNIQUE, as in sessions.
CREATE INDEX IF NOT EXISTS mcp_tokens_user_idx
  ON mcp_tokens (user_id) WHERE revoked_at IS NULL;

INSERT INTO schema_migrations (version) VALUES ('005_mcp_tokens')
  ON CONFLICT (version) DO NOTHING;
