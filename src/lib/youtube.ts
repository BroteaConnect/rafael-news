// YouTube links → the 11-character video id, and the URLs built back from it.
//
// SELF-CONTAINED ON PURPOSE: this module must never gain a relative import.
// `src/lib/load-ts.mjs` strips the types with esbuild and imports the result as
// a `data:` URL, which resolves no relative specifiers — the same constraint
// `markdown.ts`, `dates.ts` and `newsletter/core.ts` already live under. An
// added import breaks `youtube.test.mjs` with an opaque error, not a clear one.
//
// What is stored is the ID, never the URL the journalist pasted. That value
// ends up inside an iframe `src`, and an author-controlled string that reaches
// an attribute is exactly the failure mode `markdown.ts` was hand-written to
// avoid. Everything that leaves here has been through `VIDEO_ID`.

/** The shape YouTube ids have had since 2007: 11 chars of URL-safe base64. */
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The only hosts a link may come from. Matched by EQUALITY (optionally with
 *  one known subdomain), never with `includes()`: `youtube.com.evil.tld`
 *  contains 'youtube.com' and is not YouTube. */
const HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'];
const SUBDOMAINS = ['www.', 'm.', 'music.'];

function isYouTubeHost(hostname: string): boolean {
  // A trailing dot is a legal absolute FQDN and resolves the same.
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (HOSTS.includes(host)) return true;
  return SUBDOMAINS.some((sub) => host.startsWith(sub) && HOSTS.includes(host.slice(sub.length)));
}

/**
 * The video id in whatever the desk pasted, or `null` if it is not a YouTube
 * link. Accepts a bare id, `youtu.be/<id>`, `/watch?v=<id>`, `/embed/<id>`,
 * `/shorts/<id>`, `/live/<id>` and `/v/<id>`. Extra parameters (`&t=`,
 * `&list=`, `?si=`) are read and dropped: no start offset is stored.
 *
 * Never throws. A raw string is not a URL and `new URL()` would throw on it,
 * which in an editor form has to read as "that is not a video", not as a 500.
 */
export function parseYouTubeId(input: string): string | null {
  const raw = String(input ?? '').trim();
  if (raw === '') return null;
  if (VIDEO_ID.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!isYouTubeHost(url.hostname)) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  let candidate: string | undefined;
  if (url.hostname.toLowerCase().replace(/\.$/, '').endsWith('youtu.be')) {
    candidate = segments[0];
  } else if (segments[0] === 'watch') {
    candidate = url.searchParams.get('v') ?? undefined;
  } else if (['embed', 'shorts', 'live', 'v'].includes(segments[0] ?? '')) {
    candidate = segments[1];
  }

  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

/** The player URL. `youtube-nocookie.com` is the privacy-enhanced domain: no
 *  cookie is written until playback starts, which is what makes the poster
 *  facade a promise instead of decoration. `encodeURIComponent` is defence in
 *  depth — a valid id passes through it unchanged. */
export const embedUrl = (id: string): string =>
  `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`;

/** Where the desk goes to confirm they pasted the right video. */
export const watchUrl = (id: string): string =>
  `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
