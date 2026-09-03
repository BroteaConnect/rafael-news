// The only module of the app that talks to Google. The pure half of the flow
// (state, PKCE, ID token checks) lives in core.ts so that CI can test it; here
// there is one fetch and the two env vars, read once at module top exactly as
// mail/transport.ts reads SMTP_*.
//
// Runtime variables, never PUBLIC_*: the client secret must never reach the
// bundle, and the client id has no business there either since the newsroom
// ships no JavaScript. Without both, the feature is inert: the button is not
// rendered and both routes answer 404.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
/** A slow token endpoint must fail the attempt, never hang the request. */
const EXCHANGE_TIMEOUT_MS = 5000;

export const googleConfigured = (): boolean => Boolean(CLIENT_ID && CLIENT_SECRET);
export const googleClientId = (): string => CLIENT_ID ?? '';

/**
 * Redeems the authorization code for the ID token. Returns the raw ID token or
 * null. NEVER throws: an outage at Google is `?google=failed` on the sign-in
 * page, not a 500 with a stack trace. Only the HTTP status is logged, never the
 * body, which may carry tokens.
 */
export async function exchangeCode(
  code: string, verifier: string, redirectUri: string,
): Promise<string | null> {
  if (!CLIENT_ID || !CLIENT_SECRET) return null;
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('[google] token exchange answered', res.status);
      return null;
    }
    const json: unknown = await res.json();
    const idToken = json && typeof json === 'object' ? (json as { id_token?: unknown }).id_token : undefined;
    return typeof idToken === 'string' && idToken ? idToken : null;
  } catch (e) {
    console.error('[google] token exchange failed:', (e as Error).message);
    return null;
  }
}
