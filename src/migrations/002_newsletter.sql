-- Suscriptores del boletín, con doble opt-in.
--
-- Hasta que el lector pincha el enlace de confirmación NO es suscriptor: su
-- correo está guardado en 'pending' y no recibe nada más. Eso protege de que
-- alguien apunte a un tercero y de que nosotros enviemos a quien no lo pidió.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- citext para que Ana@x.com y ana@x.com no sean dos suscriptores distintos
  email             citext NOT NULL UNIQUE,
  locale            text   NOT NULL DEFAULT 'es',
  status            text   NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','confirmed','unsubscribed')),
  -- Solo el hash. Con la tabla delante nadie puede confirmar altas ajenas ni
  -- dar de baja a otro: mismo criterio que tendrán las sesiones en F5.
  token_hash        text   NOT NULL,
  token_expires_at  timestamptz,
  confirmed_at      timestamptz,
  unsubscribed_at   timestamptz,
  source            text   NOT NULL DEFAULT 'portada',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS newsletter_token_idx  ON newsletter_subscribers (token_hash);
CREATE INDEX IF NOT EXISTS newsletter_status_idx ON newsletter_subscribers (status);

INSERT INTO schema_migrations (version) VALUES ('002_newsletter')
  ON CONFLICT (version) DO NOTHING;
