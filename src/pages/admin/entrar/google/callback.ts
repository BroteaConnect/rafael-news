import type { APIRoute } from 'astro';
import {
  GOOGLE_OAUTH_COOKIE, RateLimiter, csrfMatches, parseIdToken, type GoogleFailure,
} from '../../../../lib/auth/core';
import { setSessionCookies } from '../../../../lib/auth/cookies';
import { exchangeCode, googleClientId, googleConfigured } from '../../../../lib/auth/google';
import { audit, configured, linkGoogle, startSession, userForGoogle } from '../../../../lib/auth/store';
import { normalizeEmail } from '../../../../lib/newsletter/core';

// Where Google sends the browser back. Every outcome is a redirect: success
// lands on /admin with the same session cookie the password form sets, and
// every failure lands on /admin/entrar?google=<code> where the code comes from
// a closed map. Nothing here answers 500: a Postgres blip or a slow Google is
// a failed attempt, exactly as the middleware treats a session it cannot read.
export const prerender = false;

// No scrypt here, so CPU is not the lever; the audit log is. Per IP, in
// memory, per process, like the sign-in form's own limiter.
const perIp = new RateLimiter(20, 300_000);

const OAUTH_COOKIE_PATH = { path: '/admin/entrar/google' };

export const GET: APIRoute = async ({ clientAddress, cookies, redirect, request, site, url }) => {
  if (!googleConfigured()) return new Response(null, { status: 404 });

  const back = (code: GoogleFailure) => redirect(`/admin/entrar?google=${code}`, 303);

  // Single use: whatever happens next, including being rate-limited, this
  // attempt's state is spent.
  const raw = cookies.get(GOOGLE_OAUTH_COOKIE)?.value ?? '';
  cookies.delete(GOOGLE_OAUTH_COOKIE, OAUTH_COOKIE_PATH);
  const [state, nonce, verifier] = raw.split('.');

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientAddress || 'unknown';
  if (perIp.limited(ip)) return back('failed');

  // The person pressed "cancel" on Google's screen. Not an error worth auditing.
  if (url.searchParams.get('error') === 'access_denied') return back('cancelled');

  // Constant-time, the same comparison the CSRF check uses: state is the
  // callback's CSRF token. A missing cookie (expired, or a callback that was
  // never started here) fails the same way as a forged one.
  if (!state || !nonce || !verifier || !csrfMatches(state, url.searchParams.get('state'))) {
    return back('state');
  }
  const code = url.searchParams.get('code');
  if (!code) return back('failed');
  if (!configured()) return back('failed');

  const redirectUri = new URL('/admin/entrar/google/callback', site ?? url.origin).href;
  const idToken = await exchangeCode(code, verifier, redirectUri);
  if (!idToken) return back('failed');

  const parsed = parseIdToken(idToken, { clientId: googleClientId(), nonce, now: new Date() });
  try {
    if (parsed.ok === false) {
      await audit('login.failed', null, { provider: 'google', reason: parsed.reason }, ip);
      return back('failed');
    }
    // The same normalisation the invitation form applied when this address was
    // first trusted, so the two sides of the match are spelt the same way.
    const email = normalizeEmail(parsed.email);
    if (!email) {
      await audit('login.failed', null, { provider: 'google', reason: 'email' }, ip);
      return back('failed');
    }

    const user = await userForGoogle(parsed.sub, email);
    // Three refusals, one answer. `unknown` tells the person their OWN account
    // is not in the newsroom, which enumerates nobody else's.
    const refusal = !user ? 'unknown'
      : user.status !== 'active' ? 'inactive'
      // The address matched but the account is pinned to another Google
      // identity: the mailbox changed hands on Google's side.
      : user.googleSub && user.googleSub !== parsed.sub ? 'sub-mismatch'
      : null;
    if (refusal || !user) {
      await audit('login.failed', user?.id ?? null, { provider: 'google', email, reason: refusal }, ip);
      return back('unknown');
    }

    if (!user.googleSub && !(await linkGoogle(user.id, parsed.sub, ip))) {
      // The link did not land: another callback pinned this account between
      // our read and our write. Only the identity that won may go on.
      const pinned = await userForGoogle(parsed.sub, email);
      if (pinned?.id !== user.id || pinned.googleSub !== parsed.sub) {
        await audit('login.failed', user.id, { provider: 'google', email, reason: 'sub-race' }, ip);
        return back('unknown');
      }
    }
    const token = await startSession(user.id, ip, request.headers.get('user-agent') ?? '', 'google');
    setSessionCookies(cookies, token);
    return redirect('/admin', 303);
  } catch (e) {
    console.error('[google] callback failed:', (e as Error).message);
    return back('failed');
  }
};
