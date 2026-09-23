// La redacción contra Postgres. La criptografía y las reglas viven en core.ts,
// que es lo que se prueba en CI; aquí solo hay consultas.
import pg from 'pg';
import {
  hashPassword, hashToken, hoursFrom, INVITE_HOURS, newToken, RESET_HOURS,
  sessionExpiry, tokenMatches, verifyPassword, type Role,
} from './core';

let pool: pg.Pool | null = null;
const db = (): pg.Pool => (pool ??= new pg.Pool({
  connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000,
}));
export const configured = (): boolean => Boolean(process.env.DATABASE_URL);

export interface SessionUser {
  id: number; email: string; role: Role; status: string; authorId: string | null;
}

export async function audit(
  action: string, actorId: number | null, payload: Record<string, unknown> = {}, ip?: string,
): Promise<void> {
  try {
    await db().query(
      'INSERT INTO audit_log (actor_id, action, payload, ip) VALUES ($1,$2,$3,$4)',
      [actorId, action, JSON.stringify(payload), ip ?? null],
    );
  } catch (e) {
    // Que falle la auditoría no puede tumbar la acción auditada, pero tampoco
    // puede pasar en silencio.
    console.error('[auth] no se pudo auditar', action, (e as Error).message);
  }
}

/** Entrar. Devuelve el token de sesión EN CLARO (solo para la cookie) o null.
 *  El motivo del fallo no sale de aquí: quien pregunta desde fuera no puede
 *  distinguir «no existe» de «contraseña incorrecta», o el formulario diría
 *  quién escribe en este medio. */
export async function login(email: string, password: string, ip: string, ua: string): Promise<string | null> {
  const { rows } = await db().query(
    'SELECT id, password_hash, status FROM users WHERE email = $1', [email],
  );
  const user = rows[0];
  const ok = user && user.status === 'active' && verifyPassword(password, user.password_hash);
  if (!ok) {
    // Se verifica igualmente contra un hash falso cuando el usuario no existe,
    // para que el tiempo de respuesta no revele si el correo está registrado.
    if (!user) verifyPassword(password, hashPassword('no-existe-este-usuario'));
    await audit('login.failed', user?.id ?? null, { email }, ip);
    return null;
  }
  // pg returns bigint as a string; both doors hand startSession the same type.
  return startSession(Number(user.id), ip, ua, 'password');
}

export type LoginProvider = 'password' | 'google';

/** Opens a session for a user who has ALREADY been authenticated, whichever
 *  door they came through, and returns the token in clear for the cookie.
 *  Always a fresh token: a pre-authentication value reused here would be a
 *  session fixation. */
export async function startSession(
  userId: number, ip: string, ua: string, provider: LoginProvider,
): Promise<string> {
  const token = newToken();
  await db().query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5)`,
    [userId, hashToken(token), sessionExpiry(new Date()), ip, ua.slice(0, 300)],
  );
  await db().query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  await audit('login.ok', userId, { provider }, ip);
  return token;
}

// -- Google identity -----------------------------------------------------------
// Google never creates an account. It may open one that an invitation already
// created, matched by the sub it was pinned to or, the first time, by the
// verified email. The decision of whether that match is acceptable is the
// callback's; this only fetches what it needs to decide.

export interface GoogleCandidate { id: number; status: string; googleSub: string | null }

/** The user a Google identity could sign in as, or null. A `google_sub` match
 *  wins over an email match: the pinned identity is the stronger claim, and an
 *  address that changed hands on Google's side must not open the old account. */
export async function userForGoogle(sub: string, email: string): Promise<GoogleCandidate | null> {
  const { rows } = await db().query(
    `SELECT id, status, google_sub FROM users
     WHERE google_sub = $1 OR email = $2
     ORDER BY (google_sub = $1) IS TRUE DESC
     LIMIT 1`, [sub, email],
  );
  const row = rows[0];
  return row ? { id: Number(row.id), status: row.status, googleSub: row.google_sub ?? null } : null;
}

/** Pins a Google account to a user. `google_sub IS NULL` in the WHERE is not
 *  decoration: a link happens once, and never overwrites another one. */
export async function linkGoogle(userId: number, sub: string, ip?: string): Promise<boolean> {
  const { rowCount } = await db().query(
    'UPDATE users SET google_sub = $2, google_linked_at = now(), updated_at = now() WHERE id = $1 AND google_sub IS NULL',
    [userId, sub],
  );
  if (rowCount) await audit('google.linked', userId, {}, ip);
  return Boolean(rowCount);
}

/** La sesión de una cookie, o null. Renueva la caducidad (deslizante) y de paso
 *  comprueba que el usuario siga activo: suspender tiene que echar a quien ya
 *  está dentro, no solo impedirle volver. */
export async function sessionFromToken(token: string): Promise<SessionUser | null> {
  const { rows } = await db().query(
    `SELECT s.id AS sid, s.token_hash, s.expires_at, u.id, u.email, u.role, u.status, u.author_id
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL`, [hashToken(token)],
  );
  const row = rows[0];
  if (!row || !tokenMatches(token, row.token_hash)) return null;
  if (row.expires_at.getTime() <= Date.now()) return null;
  if (row.status !== 'active') return null;

  await db().query(
    'UPDATE sessions SET last_seen_at = now(), expires_at = $2 WHERE id = $1',
    [row.sid, sessionExpiry(new Date())],
  );
  return { id: row.id, email: row.email, role: row.role, status: row.status, authorId: row.author_id };
}

export async function logout(token: string): Promise<void> {
  await db().query(
    'UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashToken(token)],
  );
}

/** Invitar. Devuelve el token en claro para el enlace del correo. */
export async function invite(email: string, role: Role, byUserId: number): Promise<string> {
  const token = newToken();
  await db().query(
    `INSERT INTO invites (email, role, token_hash, invited_by, expires_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [email, role, hashToken(token), byUserId, hoursFrom(new Date(), INVITE_HOURS)],
  );
  await audit('user.invited', byUserId, { email, role });
  return token;
}

export type AcceptResult = 'ok' | 'expired' | 'unknown' | 'weak';

/** Aceptar la invitación crea el usuario y su ficha pública de autor: quien
 *  entra en una redacción viene a firmar. */
export async function acceptInvite(token: string, password: string, name: string): Promise<AcceptResult> {
  const { rows } = await db().query(
    'SELECT id, email, role, token_hash, expires_at, accepted_at FROM invites WHERE token_hash = $1',
    [hashToken(token)],
  );
  const inv = rows[0];
  if (!inv || !tokenMatches(token, inv.token_hash) || inv.accepted_at) return 'unknown';
  if (inv.expires_at.getTime() <= Date.now()) return 'expired';

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const slugBase = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'redaccion';
    const authorId = `aut-${slugBase}`;
    await client.query(
      'INSERT INTO authors (id, slug, name) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING',
      [authorId, slugBase, name],
    );
    const { rows: userRows } = await client.query(
      `INSERT INTO users (email, password_hash, role, status, author_id)
       VALUES ($1,$2,$3,'active',$4)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash, status = 'active', updated_at = now()
       RETURNING id`,
      [inv.email, hashPassword(password), inv.role, authorId],
    );
    await client.query('UPDATE invites SET accepted_at = now() WHERE id = $1', [inv.id]);
    await client.query('COMMIT');
    await audit('user.accepted_invite', userRows[0].id, { email: inv.email, role: inv.role });
    return 'ok';
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** El perfil público de quien está dentro. Escribe en las MISMAS tablas que
 *  lee la portada, así que un cambio se ve en el bloque de autor al instante
 *  (el trigger de contenido sube la versión y refresca la instantánea). */
export async function updateProfile(
  user: SessionUser, name: string, role: string, bio: string, locale: string,
): Promise<void> {
  if (!user.authorId) return;
  await db().query('UPDATE authors SET name = $2, updated_at = now() WHERE id = $1',
    [user.authorId, name]);
  await db().query(
    `INSERT INTO author_i18n (author_id, locale, role, bio) VALUES ($1,$2,$3,$4)
     ON CONFLICT (author_id, locale) DO UPDATE SET role = EXCLUDED.role, bio = EXCLUDED.bio`,
    [user.authorId, locale, role, bio],
  );
  await audit('profile.updated', user.id, { locale });
}

export async function profileOf(authorId: string, locale: string): Promise<{
  name: string; role: string; bio: string;
} | null> {
  const { rows } = await db().query(
    `SELECT a.name, COALESCE(i.role,'') AS role, COALESCE(i.bio,'') AS bio
     FROM authors a LEFT JOIN author_i18n i ON i.author_id = a.id AND i.locale = $2
     WHERE a.id = $1`, [authorId, locale],
  );
  return rows[0] ?? null;
}

export async function requestReset(email: string): Promise<string | null> {
  const { rows } = await db().query("SELECT id FROM users WHERE email = $1 AND status = 'active'", [email]);
  if (!rows[0]) return null;
  const token = newToken();
  await db().query(
    'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
    [rows[0].id, hashToken(token), hoursFrom(new Date(), RESET_HOURS)],
  );
  return token;
}

export async function applyReset(token: string, password: string): Promise<AcceptResult> {
  const { rows } = await db().query(
    'SELECT id, user_id, token_hash, expires_at, used_at FROM password_resets WHERE token_hash = $1',
    [hashToken(token)],
  );
  const reset = rows[0];
  if (!reset || !tokenMatches(token, reset.token_hash) || reset.used_at) return 'unknown';
  if (reset.expires_at.getTime() <= Date.now()) return 'expired';
  await db().query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1',
    [reset.user_id, hashPassword(password)]);
  await db().query('UPDATE password_resets SET used_at = now() WHERE id = $1', [reset.id]);
  // Cambiar la contraseña echa a todas las sesiones abiertas: si alguien te la
  // robó, cambiarla tiene que servir de algo.
  await db().query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [reset.user_id]);
  await audit('password.reset', reset.user_id, {});
  return 'ok';
}

// -- MCP keys ------------------------------------------------------------------
// A second way of authenticating, so it lives beside sessionFromToken and not in
// a module of its own: it reuses this file's pool, its crypto imports and
// audit(). A fifth pg.Pool for four queries would not pay for itself.

export interface McpPrincipal {
  tokenId: number; userId: number; role: Role; authorId: string | null; scopes: string[];
}

/** A chatty client would otherwise turn every tool call into a write. */
const LAST_USED_REFRESH_MS = 5 * 60_000;

/** Who is behind an `Authorization: Bearer`, or null. Mirrors sessionFromToken,
 *  including the check that the user is still `active`: suspending someone has
 *  to kill their keys too, not only their browser. */
export async function mcpPrincipalFromToken(token: string): Promise<McpPrincipal | null> {
  const { rows } = await db().query(
    `SELECT m.id AS token_id, m.token_hash, m.scopes, m.expires_at, m.last_used_at,
            u.id AS user_id, u.role, u.status, u.author_id
     FROM mcp_tokens m JOIN users u ON u.id = m.user_id
     WHERE m.token_hash = $1 AND m.revoked_at IS NULL`, [hashToken(token)],
  );
  const row = rows[0];
  if (!row || !tokenMatches(token, row.token_hash)) return null;
  // NULL expiry = never expires; that is a decision of whoever minted the key.
  if (row.expires_at && row.expires_at.getTime() <= Date.now()) return null;
  if (row.status !== 'active') return null;

  const lastUsed = row.last_used_at ? row.last_used_at.getTime() : 0;
  if (Date.now() - lastUsed > LAST_USED_REFRESH_MS) {
    // Best-effort, and deliberately not awaited into the answer: this is
    // bookkeeping for the "last used" column on /admin/mcp. Letting it throw
    // would turn a perfectly valid key into a 503 because a cosmetic UPDATE
    // failed.
    void db().query('UPDATE mcp_tokens SET last_used_at = now() WHERE id = $1', [row.token_id])
      .catch((e: Error) => console.error('[mcp] could not stamp last_used_at:', e.message));
  }
  return {
    tokenId: Number(row.token_id),
    userId: Number(row.user_id),
    role: row.role,
    authorId: row.author_id,
    scopes: row.scopes ?? [],
  };
}

/** Mint a key. Returns the token in clear, which is the only moment it exists:
 *  the row keeps its sha256, like sessions and invitations. The `mcp_` prefix is
 *  for secret scanners and for whoever finds the string in a config file. */
export async function issueMcpToken(
  userId: number, name: string, scopes: string[], expiresAt: Date | null,
): Promise<string> {
  const token = `mcp_${newToken()}`;
  const { rows } = await db().query(
    `INSERT INTO mcp_tokens (user_id, name, token_hash, scopes, expires_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [userId, name, hashToken(token), scopes, expiresAt],
  );
  await audit('mcp.token.issued', userId, { tokenId: Number(rows[0].id), name, scopes });
  return token;
}

export interface McpTokenRow {
  id: number; name: string; scopes: string[];
  createdAt: string; expiresAt: string | null; lastUsedAt: string | null;
}

/** The live keys of one person. Never the hash: it is not shown, not even to
 *  its owner, because there is nothing useful to do with it. */
export async function listMcpTokens(userId: number): Promise<McpTokenRow[]> {
  const { rows } = await db().query(
    `SELECT id, name, scopes, created_at, expires_at, last_used_at
     FROM mcp_tokens WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC`, [userId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    scopes: r.scopes ?? [],
    createdAt: new Date(r.created_at).toISOString(),
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
  }));
}

/** Revoke. The `user_id` in the WHERE is not decoration: without it, anyone
 *  signed in could revoke someone else's key by guessing an id. Takes effect on
 *  the very next request, because the lookup carries `revoked_at IS NULL`. */
export async function revokeMcpToken(id: number, userId: number): Promise<boolean> {
  const { rowCount } = await db().query(
    'UPDATE mcp_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
    [id, userId],
  );
  if (rowCount) await audit('mcp.token.revoked', userId, { tokenId: id });
  return Boolean(rowCount);
}
