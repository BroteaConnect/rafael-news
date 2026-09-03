// La criptografía y las reglas de la redacción. Es lo que no puede estar mal:
// un fallo aquí no da un error visible, da una puerta abierta.
//
// Vive en src/locales/ porque es la ruta que recorre el `npm test` del gate de
// la fábrica; su sitio natural sería src/lib/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from '../lib/load-ts.mjs';

const {
  GOOGLE_OAUTH_COOKIE, GOOGLE_OAUTH_MINUTES, MIN_PASSWORD, RateLimiter, ROLES,
  can, csrfMatches, googleAuthUrl, googleFailureFromQuery, hashPassword, hashToken, hoursFrom,
  isExpired, isRole, newCsrf, newOauthState, newToken, parseIdToken, passwordProblem, pkceChallenge,
  sessionExpiry, tokenMatches, verifyPassword,
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
  // An MCP key can never exceed what its owner may do, so every role carries
  // the permission: what the key will actually do is bounded by its scopes.
  assert.equal(can('journalist', 'mcp:token'), true);
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

// -- Google sign-in ------------------------------------------------------------
// What the callback trusts without a signature check is exactly what has to be
// pinned here: a wrong audience, a replayed nonce, an expired token or an
// unverified email are each a door, not an error message.

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const idToken = (claims) => {
  const seg = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${seg({ alg: 'RS256', typ: 'JWT' })}.${seg(claims)}.signature-never-checked`;
};
const NOW = new Date('2026-09-03T10:00:00Z');
const GOOD = {
  iss: 'https://accounts.google.com', aud: 'client-id.apps.googleusercontent.com',
  exp: Math.floor(NOW.getTime() / 1000) + 3600, nonce: 'expected-nonce',
  sub: '1234567890', email: 'Someone@Example.com', email_verified: true,
};
const EXPECTED = { clientId: GOOD.aud, nonce: GOOD.nonce, now: NOW };

test('the OAuth state is three distinct base64url tokens, in a 10 minute cookie', () => {
  const { state, nonce, verifier } = newOauthState();
  assert.equal(new Set([state, nonce, verifier]).size, 3, 'state, nonce and verifier must never coincide');
  for (const v of [state, nonce, verifier]) {
    assert.match(v, BASE64URL, 'no dots or symbols: they travel together in one dot-separated cookie');
    assert.ok(v.length >= 32);
  }
  assert.notEqual(newOauthState().state, state);
  assert.equal(GOOGLE_OAUTH_COOKIE, 'brotea_google_oauth');
  assert.equal(GOOGLE_OAUTH_MINUTES, 10);
});

test('PKCE S256: the known vector from RFC 7636', () => {
  assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('the Google URL carries code, PKCE S256, openid email and the nonce', () => {
  const href = googleAuthUrl({
    clientId: 'cid', redirectUri: 'https://rafael-news.brotea.dev/admin/entrar/google/callback',
    state: 'st', nonce: 'no', challenge: 'ch',
  });
  const url = new URL(href);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'openid email');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), 'ch');
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('state'), 'st');
  assert.equal(url.searchParams.get('nonce'), 'no');
  assert.equal(url.searchParams.get('prompt'), 'select_account');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://rafael-news.brotea.dev/admin/entrar/google/callback');
});

test('parseIdToken accepts a good token and returns sub and email verbatim', () => {
  const parsed = parseIdToken(idToken(GOOD), EXPECTED);
  assert.deepEqual(parsed, { ok: true, sub: '1234567890', email: 'Someone@Example.com' });
  assert.equal(parseIdToken(idToken({ ...GOOD, iss: 'accounts.google.com' }), EXPECTED).ok, true,
    'Google issues the iss with and without https');
});

test('parseIdToken rejects another aud, another nonce, an expired token and another issuer', () => {
  const reason = (claims, expected = EXPECTED) => parseIdToken(idToken(claims), expected).reason;
  assert.equal(reason({ ...GOOD, aud: 'another-client' }), 'audience');
  assert.equal(reason(GOOD, { ...EXPECTED, nonce: 'another-nonce' }), 'nonce');
  assert.equal(reason({ ...GOOD, nonce: undefined }), 'nonce', 'without a nonce there is no proof it is this request');
  assert.equal(reason({ ...GOOD, exp: Math.floor(NOW.getTime() / 1000) - 120 }), 'expired');
  assert.equal(reason({ ...GOOD, exp: Math.floor(NOW.getTime() / 1000) - 30 }, EXPECTED), undefined,
    'a clock skew under one minute is not an expiry');
  assert.equal(reason({ ...GOOD, exp: 'tomorrow' }), 'expired');
  assert.equal(reason({ ...GOOD, iss: 'https://accounts.example.com' }), 'issuer');
});

test('parseIdToken demands email_verified === true, not something like it', () => {
  const reason = (claims) => parseIdToken(idToken(claims), EXPECTED).reason;
  assert.equal(reason({ ...GOOD, email_verified: false }), 'unverified');
  assert.equal(reason({ ...GOOD, email_verified: 'true' }), 'unverified', 'a string is not an assertion');
  assert.equal(reason({ ...GOOD, email_verified: 1 }), 'unverified');
  const { email_verified: _omitted, ...withoutClaim } = GOOD;
  assert.equal(reason(withoutClaim), 'unverified', 'a missing claim counts as unverified');
  assert.equal(reason({ ...GOOD, email: '' }), 'claims');
  assert.equal(reason({ ...GOOD, sub: undefined }), 'claims');
});

test('parseIdToken never throws on garbage: it returns malformed', () => {
  for (const garbage of [null, undefined, 42, '', 'a.b', 'a.b.c.d', 'x..y', `h.${Buffer.from('[1]').toString('base64url')}.s`,
    `h.${Buffer.from('not json').toString('base64url')}.s`]) {
    const parsed = parseIdToken(garbage, EXPECTED);
    assert.equal(parsed.ok, false, `with: ${String(garbage)}`);
    assert.equal(parsed.reason, 'malformed', `with: ${String(garbage)}`);
  }
});

test('the Google failure code is a closed map: nothing is reflected', () => {
  for (const code of ['cancelled', 'state', 'unknown', 'failed']) {
    assert.equal(googleFailureFromQuery(code), code);
  }
  for (const bad of ['<script>', 'CANCELLED', '', null, undefined, 'failed ', ['failed'], 'constructor']) {
    assert.equal(googleFailureFromQuery(bad), null, `with: ${String(bad)}`);
  }
});
