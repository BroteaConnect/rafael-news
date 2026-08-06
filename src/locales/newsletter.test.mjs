// Lógica pura del boletín. Vive en src/locales/ porque es lo que recorre el
// `npm test` que materializa el gate de la fábrica (`src/locales/*.test.mjs`);
// el sitio natural sería src/lib/, y ampliar ese patrón es un cambio de
// catálogo, no de este repo.
//
// Cubre lo que no puede fallar en silencio: qué se acepta como correo, que el
// token en claro no se pueda deducir del guardado, la caducidad, y que el
// limitador limite de verdad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from '../lib/load-ts.mjs';

const {
  CONFIRM_TTL_HOURS, MAX_EMAIL, RateLimiter,
  confirmExpiry, hashToken, isExpired, newToken, normalizeEmail, tokenMatches,
} = await loadTs(new URL('../lib/newsletter/core.ts', import.meta.url));

test('normalizeEmail acepta lo razonable y normaliza', () => {
  assert.equal(normalizeEmail('  Ana@Example.COM '), 'ana@example.com');
  assert.equal(normalizeEmail('a+etiqueta@dominio.es'), 'a+etiqueta@dominio.es');
});

test('normalizeEmail rechaza los disparates, no las direcciones raras pero válidas', () => {
  for (const malo of ['', '   ', 'sin-arroba', 'a@b', 'a@b.c', 'con espacio@x.com', 'a@@x.com', 42, null]) {
    assert.equal(normalizeEmail(malo), null, `debería rechazar: ${String(malo)}`);
  }
  assert.equal(normalizeEmail(`${'a'.repeat(MAX_EMAIL)}@x.com`), null, 'demasiado largo');
});

test('el token en claro no se guarda: solo su hash, y es estable', () => {
  const token = newToken();
  const hash = hashToken(token);
  assert.notEqual(hash, token);
  assert.equal(hash.length, 64, 'sha256 en hexadecimal');
  assert.equal(hashToken(token), hash, 'el mismo token da el mismo hash');
});

test('cada token es distinto', () => {
  const tokens = new Set(Array.from({ length: 200 }, () => newToken()));
  assert.equal(tokens.size, 200);
});

test('tokenMatches acepta el bueno y rechaza el resto', () => {
  const token = newToken();
  assert.equal(tokenMatches(token, hashToken(token)), true);
  assert.equal(tokenMatches(newToken(), hashToken(token)), false);
  // Un hash de otra longitud no puede reventar la comparación en tiempo
  // constante: tiene que devolver false, no lanzar.
  assert.equal(tokenMatches(token, 'abc'), false);
});

test('la confirmación caduca a las 72 horas, la baja nunca', () => {
  const ahora = new Date('2026-08-06T10:00:00Z');
  const caduca = confirmExpiry(ahora);
  assert.equal((caduca.getTime() - ahora.getTime()) / 3600_000, CONFIRM_TTL_HOURS);
  assert.equal(isExpired(caduca, ahora), false);
  assert.equal(isExpired(caduca, new Date('2026-08-09T10:00:01Z')), true);
  assert.equal(isExpired(null, ahora), false, 'sin caducidad = no caduca (el enlace de baja)');
});

test('el limitador limita, y por clave', () => {
  const limiter = new RateLimiter(2, 60_000);
  const t0 = 1_000_000;
  assert.equal(limiter.limited('a', t0), false);
  assert.equal(limiter.limited('a', t0 + 1), false);
  assert.equal(limiter.limited('a', t0 + 2), true, 'la tercera en la ventana ya pasa del límite');
  assert.equal(limiter.limited('b', t0 + 3), false, 'otra clave va por su cuenta');
  // Fuera de la ventana vuelve a contar desde cero: si no, un límite por IP
  // acabaría bloqueando para siempre a quien comparte salida (una oficina).
  assert.equal(limiter.limited('a', t0 + 60_001), false);
});
