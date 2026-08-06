// La lógica del boletín que NO necesita ni base de datos ni red, separada a
// propósito para que se pueda probar entera con `node --test` — que es lo que
// corre el CI del proyecto. Lo que toca Postgres o SMTP vive en store.ts.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Validación deliberadamente laxa: aquí solo caen los disparates (sin arroba,
 *  sin dominio, con espacios). Quién es dueño del buzón lo decide el correo de
 *  confirmación, no una expresión regular — ninguna acierta, y las que lo
 *  intentan acaban rechazando direcciones válidas de gente real. */
const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MAX_EMAIL = 200;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL || !SHAPE.test(email)) return null;
  return email;
}

/** 32 bytes de aleatoriedad criptográfica. En claro solo viaja al buzón del
 *  interesado; en la base queda su hash. */
export const newToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** Comparación en tiempo constante: comparar hashes con `===` filtra, por el
 *  tiempo de respuesta, cuántos caracteres iniciales acertaste. */
export function tokenMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export const CONFIRM_TTL_HOURS = 72;
export const confirmExpiry = (now: Date): Date =>
  new Date(now.getTime() + CONFIRM_TTL_HOURS * 3600_000);
export const isExpired = (expiresAt: Date | null, now: Date): boolean =>
  expiresAt !== null && expiresAt.getTime() <= now.getTime();

/**
 * Límite de peticiones por ventana. Guardar el correo es barato; ENVIARLO no,
 * y una lista de correo es un arma si cualquiera puede disparar mil envíos a
 * direcciones ajenas desde un formulario público.
 */
export class RateLimiter {
  #hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}

  limited(key: string, now = Date.now()): boolean {
    const recent = (this.#hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    recent.push(now);
    this.#hits.set(key, recent);
    // Cota de memoria bruta: sin esto, una IP distinta por petición convierte
    // el limitador en una fuga de memoria con forma de defensa.
    if (this.#hits.size > 10_000) this.#hits.clear();
    return recent.length > this.max;
  }
}
