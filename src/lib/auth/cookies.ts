// The cookies a sign-in sets, in one place. Two doors open a session today
// (the password form and the Google callback) and they must set exactly the
// same cookies with exactly the same flags: a copy that drifts is how one door
// ends up with a CSRF token from the previous visitor.
import type { AstroCookies } from 'astro';
import { CSRF_COOKIE, SESSION_COOKIE, newCsrf, sessionExpiry } from './core';

export function setSessionCookies(cookies: AstroCookies, token: string): void {
  cookies.set(SESSION_COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: import.meta.env.PROD,
    expires: sessionExpiry(new Date()),
  });
  // A fresh CSRF cookie per session: reusing the previous one leaves a valid
  // token behind on a shared computer.
  cookies.set(CSRF_COOKIE, newCsrf(), {
    path: '/', httpOnly: false, sameSite: 'lax', secure: import.meta.env.PROD, maxAge: 86400,
  });
}
