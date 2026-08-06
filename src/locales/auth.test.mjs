// La criptografía y las reglas de la redacción. Es lo que no puede estar mal:
// un fallo aquí no da un error visible, da una puerta abierta.
//
// Vive en src/locales/ porque es la ruta que recorre el `npm test` del gate de
// la fábrica; su sitio natural sería src/lib/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from '../lib/load-ts.mjs';

const {
  MIN_PASSWORD, RateLimiter, ROLES,
  can, csrfMatches, hashPassword, hashToken, hoursFrom, isExpired, isRole,
  newCsrf, newToken, passwordProblem, sessionExpiry, tokenMatches, verifyPassword,
} = await loadTs(new URL('../lib/auth/core.ts', import.meta.url));

test('la contraseña no se guarda: se guarda un scrypt con su sal', () => {
  const stored = hashPassword('una frase larga de verdad');
  assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/);
  assert.ok(!stored.includes('una frase larga'), 'la contraseña no puede aparecer en el hash');
});

test('dos veces la misma contraseña dan hashes distintos (sal por usuario)', () => {
  assert.notEqual(hashPassword('la misma frase larga'), hashPassword('la misma frase larga'));
});

test('verifyPassword acepta la buena y rechaza el resto', () => {
  const stored = hashPassword('correcta y suficientemente larga');
  assert.equal(verifyPassword('correcta y suficientemente larga', stored), true);
  assert.equal(verifyPassword('otra cosa distinta aqui', stored), false);
  assert.equal(verifyPassword('', stored), false);
});

test('verifyPassword no revienta con basura guardada: devuelve false', () => {
  for (const basura of [null, '', 'no-es-un-hash', 'scrypt$x$y$z', 'scrypt$16384$8$1$sal']) {
    assert.equal(verifyPassword('lo que sea largo', basura), false, `con: ${String(basura)}`);
  }
});

test('la contraseña exige longitud, no jeroglíficos', () => {
  assert.equal(passwordProblem('a'.repeat(MIN_PASSWORD)), null);
  assert.equal(passwordProblem('corta'), 'short');
  assert.equal(passwordProblem('a'.repeat(201)), 'long', 'sin tope, cada intento regala CPU');
  // Una frase normal sin símbolos ni números tiene que valer: exigirlos es lo
  // que produce `P@ssw0rd1`.
  assert.equal(passwordProblem('caballo grapa correcto'), null);
});

test('los tokens no se guardan en claro y no se repiten', () => {
  const token = newToken();
  assert.equal(hashToken(token).length, 64);
  assert.notEqual(hashToken(token), token);
  assert.equal(new Set(Array.from({ length: 200 }, () => newToken())).size, 200);
  assert.equal(tokenMatches(token, hashToken(token)), true);
  assert.equal(tokenMatches(newToken(), hashToken(token)), false);
  assert.equal(tokenMatches(token, 'corto'), false, 'un hash raro devuelve false, no lanza');
});

test('CSRF: coincide consigo mismo y con nada más', () => {
  const token = newCsrf();
  assert.equal(csrfMatches(token, token), true);
  assert.equal(csrfMatches(token, newCsrf()), false);
  // Los casos que de verdad se dan en producción: falta la cookie, falta el
  // campo, o llegan cosas que no son cadenas.
  assert.equal(csrfMatches(undefined, token), false);
  assert.equal(csrfMatches(token, undefined), false);
  assert.equal(csrfMatches('', ''), false, 'dos vacíos NO son una coincidencia válida');
  assert.equal(csrfMatches(null, null), false);
  assert.equal(csrfMatches(token, token.slice(0, -1)), false);
});

test('los permisos son los de la tabla, y un rol no hereda de más arriba', () => {
  assert.equal(can('journalist', 'profile:own'), true);
  assert.equal(can('journalist', 'story:publish'), false);
  assert.equal(can('journalist', 'user:invite'), false);
  assert.equal(can('editor', 'story:publish'), true);
  assert.equal(can('editor', 'user:invite'), false, 'publicar no da derecho a invitar');
  assert.equal(can('owner', 'user:invite'), true);
  assert.equal(can('owner', 'inventado'), false);
});

test('isRole rechaza lo que no es un rol', () => {
  for (const r of ROLES) assert.equal(isRole(r), true);
  for (const malo of ['admin', 'root', '', null, 1]) assert.equal(isRole(malo), false);
});

test('caducidades: sesión 30 días, invitación 72 h, restablecer 2 h', () => {
  const ahora = new Date('2026-08-06T10:00:00Z');
  assert.equal((sessionExpiry(ahora) - ahora) / 86400_000, 30);
  assert.equal((hoursFrom(ahora, 72) - ahora) / 3600_000, 72);
  assert.equal(isExpired(hoursFrom(ahora, 2), ahora), false);
  assert.equal(isExpired(hoursFrom(ahora, -1), ahora), true);
  assert.equal(isExpired(null, ahora), true, 'sin fecha se trata como caducado, no como eterno');
});

test('el limitador limita y una entrada correcta lo borra', () => {
  const limiter = new RateLimiter(2, 60_000);
  const t0 = 1_000_000;
  assert.equal(limiter.limited('ana', t0), false);
  assert.equal(limiter.limited('ana', t0 + 1), false);
  assert.equal(limiter.limited('ana', t0 + 2), true);
  limiter.clear('ana');
  assert.equal(limiter.limited('ana', t0 + 3), false, 'quien acierta a la tercera no puede quedarse fuera');
});
