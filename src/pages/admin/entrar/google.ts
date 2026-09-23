import type { APIRoute } from 'astro';
import {
  GOOGLE_OAUTH_COOKIE, GOOGLE_OAUTH_MINUTES, googleAuthUrl, newOauthState, pkceChallenge,
} from '../../../lib/auth/core';
import { googleClientId, googleConfigured } from '../../../lib/auth/google';

// Starting the Google flow is a POST, not a link. The middleware already applies
// the double-submit CSRF check to every form POST, which gives login-CSRF
// protection for free: nobody can start a sign-in on your behalf from another
// site. It also keeps the newsroom's doctrine, forms that post and redirect.
export const prerender = false;

export const POST: APIRoute = ({ cookies, redirect, site, url }) => {
  // Not configured means not there: no button on the page, no route either.
  if (!googleConfigured()) return new Response(null, { status: 404 });

  const { state, nonce, verifier } = newOauthState();
  cookies.set(GOOGLE_OAUTH_COOKIE, `${state}.${nonce}.${verifier}`, {
    // Lax and not Strict on purpose: the callback is a top-level navigation
    // from Google, and Strict would strip the cookie from exactly that request.
    path: '/admin/entrar/google', httpOnly: true, sameSite: 'lax', secure: import.meta.env.PROD,
    maxAge: GOOGLE_OAUTH_MINUTES * 60,
  });

  // From `site`, never from `url`: behind the node adapter `url.origin` is
  // `http://localhost`, which Google rejects as an unregistered redirect URI.
  const redirectUri = new URL('/admin/entrar/google/callback', site ?? url.origin).href;
  return redirect(googleAuthUrl({
    clientId: googleClientId(), redirectUri, state, nonce, challenge: pkceChallenge(verifier),
  }), 302);
};
