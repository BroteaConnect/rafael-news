// El boletín contra Postgres. La lógica sin red vive en core.ts, que es la que
// se prueba en CI; aquí solo hay consultas y el envío del correo.
import pg from 'pg';
import { confirmExpiry, hashToken, newToken, tokenMatches } from './core';

export type SignupResult = 'sent' | 'already-confirmed' | 'unavailable';
export type TokenResult = 'ok' | 'expired' | 'unknown';

let pool: pg.Pool | null = null;
const db = (): pg.Pool => (pool ??= new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  connectionTimeoutMillis: 5000,
}));

export const configured = (): boolean => Boolean(process.env.DATABASE_URL);

/**
 * Alta. Devuelve SIEMPRE lo mismo para un correo nuevo y para uno pendiente:
 * si la respuesta distinguiera, el formulario público se convertiría en un
 * comprobador de quién está suscrito a este medio.
 *
 * Un correo ya confirmado tampoco se re-confirma ni recibe otro correo — pero
 * quien pregunta desde fuera no puede notar la diferencia.
 */
export async function signup(email: string, locale: string, source: string): Promise<{
  result: SignupResult; token: string | null;
}> {
  const token = newToken();
  const now = new Date();
  const { rows } = await db().query<{ status: string }>(
    `INSERT INTO newsletter_subscribers (email, locale, status, token_hash, token_expires_at, source)
     VALUES ($1, $2, 'pending', $3, $4, $5)
     ON CONFLICT (email) DO UPDATE SET
       -- Un alta repetida renueva el token: el enlace anterior pudo caducar o
       -- perderse, y obligar a esperar 72h a quien insiste es hostil.
       token_hash       = CASE WHEN newsletter_subscribers.status = 'confirmed'
                               THEN newsletter_subscribers.token_hash ELSE EXCLUDED.token_hash END,
       token_expires_at = CASE WHEN newsletter_subscribers.status = 'confirmed'
                               THEN newsletter_subscribers.token_expires_at ELSE EXCLUDED.token_expires_at END,
       locale           = EXCLUDED.locale,
       updated_at       = now()
     RETURNING status`,
    [email, locale, hashToken(token), confirmExpiry(now), source],
  );
  const status = rows[0]?.status ?? 'pending';
  if (status === 'confirmed') return { result: 'already-confirmed', token: null };
  return { result: 'sent', token };
}

export async function confirm(token: string): Promise<TokenResult> {
  const { rows } = await db().query<{ id: string; token_hash: string; token_expires_at: Date | null; status: string }>(
    'SELECT id, token_hash, token_expires_at, status FROM newsletter_subscribers WHERE token_hash = $1',
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row || !tokenMatches(token, row.token_hash)) return 'unknown';
  // Confirmar dos veces con el mismo enlace no es un error: quien lo pincha
  // otra vez (o su cliente de correo, que los pre-carga) debe ver éxito.
  if (row.status === 'confirmed') return 'ok';
  if (row.token_expires_at && row.token_expires_at.getTime() <= Date.now()) return 'expired';

  await db().query(
    `UPDATE newsletter_subscribers
     SET status='confirmed', confirmed_at=now(), token_expires_at=NULL, updated_at=now()
     WHERE id=$1`, [row.id],
  );
  return 'ok';
}

/** Baja. El token NO caduca a propósito: un enlace de baja muerto obliga al
 *  lector a escribir un correo para ejercer un derecho que ya tiene. */
export async function unsubscribe(token: string): Promise<TokenResult> {
  const { rows } = await db().query<{ id: string; token_hash: string }>(
    'SELECT id, token_hash FROM newsletter_subscribers WHERE token_hash = $1', [hashToken(token)],
  );
  const row = rows[0];
  if (!row || !tokenMatches(token, row.token_hash)) return 'unknown';
  await db().query(
    `UPDATE newsletter_subscribers
     SET status='unsubscribed', unsubscribed_at=now(), updated_at=now() WHERE id=$1`, [row.id],
  );
  return 'ok';
}
