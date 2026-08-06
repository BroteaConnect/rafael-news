-- La redacción: usuarios, sesiones, invitaciones y auditoría.
--
-- No hay ninguna tabla ni camino que permita crear el primer owner sin estar
-- ya dentro. Un «si no hay usuarios, el primero se hace owner» es una
-- vulnerabilidad clásica —basta con llegar antes—, así que el arranque se hace
-- insertando una invitación a mano (ver docs/redaccion.md).

CREATE TABLE IF NOT EXISTS users (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email          citext NOT NULL UNIQUE,
  -- `scrypt$N$r$p$salt$hash`: los parámetros viajan con el hash para poder
  -- subirlos mañana sin invalidar la contraseña de nadie.
  password_hash  text,
  role           text NOT NULL DEFAULT 'journalist'
                   CHECK (role IN ('journalist','editor','owner')),
  status         text NOT NULL DEFAULT 'invited'
                   CHECK (status IN ('invited','active','suspended')),
  -- La cara pública de esta persona. Un usuario sin autor puede entrar pero no
  -- firma nada; un autor sin usuario es una firma histórica.
  author_id      text REFERENCES authors(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE TABLE IF NOT EXISTS invites (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       citext NOT NULL,
  role        text   NOT NULL CHECK (role IN ('journalist','editor','owner')),
  token_hash  text   NOT NULL UNIQUE,   -- el token en claro solo va al buzón
  invited_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invites_email_idx ON invites (email) WHERE accepted_at IS NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text   NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  ip           text,
  user_agent   text
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS password_resets (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text   NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Cuando algo se publique mal, la pregunta será quién y cuándo. Sin actor
-- obligatorio: un intento de entrada fallido no tiene usuario y también
-- interesa.
CREATE TABLE IF NOT EXISTS audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id   bigint REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text,
  entity_id  text,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip         text,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_log (at DESC);

INSERT INTO schema_migrations (version) VALUES ('003_auth')
  ON CONFLICT (version) DO NOTHING;
