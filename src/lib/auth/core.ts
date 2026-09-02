// Criptografía y reglas de la redacción, sin base de datos ni red: es lo que
// se puede probar entero en CI, y es justo lo que no puede estar mal.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// -- Contraseñas ---------------------------------------------------------------
// scrypt de node:crypto y no argon2: cero dependencias, sin módulo nativo que
// compilar y sin superficie de suministro añadida. Los parámetros se guardan
// JUNTO al hash para poder subirlos mañana sin invalidar la contraseña de nadie.
// `maxmem` es obligatorio aquí y no es un detalle: scrypt necesita ~128·N·r
// bytes, que con estos parámetros son 33,5 MB, y el tope por defecto de Node son
// 32. Sin subirlo, CADA intento de entrada lanza `memory limit exceeded` —lo
// cazó el test antes de que llegara a producción—. Se calcula del propio N·r
// para que subir el coste mañana no vuelva a romperlo.
const maxmemFor = (N: number, r: number) => 128 * N * r * 2;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64, maxmem: maxmemFor(2 ** 15, 8) } as const;

/** 12 caracteres y ninguna regla de símbolos: exigir mayúscula-número-símbolo
 *  es lo que produce `P@ssw0rd1`, que es peor que una frase larga. */
export const MIN_PASSWORD = 12;
export const passwordProblem = (password: string): 'short' | 'long' | null => {
  if (password.length < MIN_PASSWORD) return 'short';
  // Un límite alto pero existente: sin él, una contraseña de 1 MB convierte
  // cada intento de entrada en trabajo de CPU regalado a quien la manda.
  if (password.length > 200) return 'long';
  return null;
};

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  let actual: Buffer;
  try {
    actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: maxmemFor(Number(n), Number(r)) });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// -- Tokens (sesión, invitación, restablecer) ----------------------------------
export const newToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** Comparar hashes con `===` filtra por tiempo cuántos caracteres acertaste. */
export function tokenMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// -- Sesiones ------------------------------------------------------------------
export const SESSION_COOKIE = 'brotea_sesion';
export const SESSION_DAYS = 30;
export const sessionExpiry = (now: Date): Date =>
  new Date(now.getTime() + SESSION_DAYS * 86400_000);

export const INVITE_HOURS = 72;
export const RESET_HOURS = 2;
export const hoursFrom = (now: Date, hours: number): Date =>
  new Date(now.getTime() + hours * 3600_000);
export const isExpired = (at: Date | null | undefined, now: Date): boolean =>
  !at || at.getTime() <= now.getTime();

// -- CSRF ----------------------------------------------------------------------
// Doble envío: el mismo valor en una cookie y en un campo oculto. `SameSite=Lax`
// solo no basta — no cubre un POST desde un subdominio comprometido ni navegadores
// viejos —, y esto cuesta una cookie y una comparación.
export const CSRF_COOKIE = 'brotea_csrf';
export const CSRF_FIELD = 'csrf';
export const newCsrf = (): string => randomBytes(24).toString('base64url');
export function csrfMatches(fromCookie: unknown, fromForm: unknown): boolean {
  if (typeof fromCookie !== 'string' || typeof fromForm !== 'string') return false;
  if (fromCookie.length === 0 || fromCookie.length !== fromForm.length) return false;
  return timingSafeEqual(Buffer.from(fromCookie), Buffer.from(fromForm));
}

// -- Roles ---------------------------------------------------------------------
export type Role = 'journalist' | 'editor' | 'owner';
export const ROLES: readonly Role[] = ['journalist', 'editor', 'owner'];
export const isRole = (v: unknown): v is Role => ROLES.includes(v as Role);

/** Qué puede hacer cada rol. Es una tabla y no una escalera de `if` para que se
 *  pueda leer de un vistazo y probar entera. */
// `mcp:token` is on the three rows, like `profile:own` and `story:own`: minting
// a key for one's own Claude client is not a privileged act, and what the key
// may do is bounded twice over — by its scopes and by the role of whoever holds
// it. It is a row of its own so that "who may point a credential at the public
// internet" is a question with an answer, and one that can be revoked per role
// tomorrow without touching a page.
const CAN = {
  journalist: ['profile:own', 'story:own', 'mcp:token'],
  editor: ['profile:own', 'story:own', 'story:any', 'story:publish', 'mcp:token'],
  owner: ['profile:own', 'story:own', 'story:any', 'story:publish', 'user:invite', 'user:role', 'mcp:token'],
} as const satisfies Record<Role, readonly string[]>;

export type Permission = (typeof CAN)[Role][number];
export const can = (role: Role, permission: string): boolean =>
  (CAN[role] as readonly string[]).includes(permission);

// -- Límite de intentos --------------------------------------------------------
/** Guardar es barato; verificar una contraseña con scrypt cuesta CPU a
 *  propósito, así que sin límite el propio hash es la palanca de un ataque. */
export class RateLimiter {
  #hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}

  limited(key: string, now = Date.now()): boolean {
    const recent = (this.#hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    recent.push(now);
    this.#hits.set(key, recent);
    if (this.#hits.size > 10_000) this.#hits.clear();
    return recent.length > this.max;
  }

  /** Una entrada correcta borra el contador: si no, quien acierta a la quinta
   *  se queda bloqueado igualmente. */
  clear(key: string): void { this.#hits.delete(key); }
}
