import type { APIRoute } from 'astro';
import { RateLimiter, hashToken } from '../../lib/auth/core';
import { configured, mcpPrincipalFromToken, type McpPrincipal } from '../../lib/auth/store';
import {
  FALLBACK_VERSION, buildTools, hasScope, isNotification, negotiateVersion, parseBearer,
  rpcError, rpcResult, validateArgs, type RpcId, type ToolDef,
} from '../../lib/mcp/protocol';
import { isError, runTool } from '../../lib/mcp/tools';
import { DEFAULT_LOCALE, LOCALES } from '../../lib/i18n';

// The MCP server: Streamable HTTP, JSON-RPC 2.0 over POST, answered by the same
// Astro process that serves the portal. No second container and no second
// protocol — the transport is one POST and one JSON response.
//
// Deliberately stateless: every answer is `Content-Type: application/json` (the
// spec allows it), there is no SSE stream and no `Mcp-Session-Id`, which is the
// only mode that survives a container restart in the middle of a conversation.
//
// **NO CORS HEADER IS EMITTED HERE, AND NO `Origin` IS EVER COMPARED.** That is
// the DNS-rebinding mitigation appropriate to a bearer-authenticated remote
// server: with no `Access-Control-Allow-Origin`, no browser page on any origin
// can attach an `Authorization` header to this route. Origin allow-listing is
// not merely unimplemented, it is refused: behind this node adapter `url.origin`
// is `http://localhost` while the browser sends the real domain, which is
// exactly why `checkOrigin: false` is set in astro.config.mjs after every
// newsroom form answered 403. Re-introducing an origin comparison re-introduces
// that bug.
export const prerender = false;

/** renderMarkdown is hand-written and linear: a 5 MB body_md is free CPU handed
 *  to whoever posts it — the same argument passwordProblem's 200-char ceiling
 *  makes. */
const MAX_BODY = 131_072;

// Per key, generously: a conversation is many small calls. Per IP, tightly, and
// only for requests that fail to authenticate — that is the path that costs a
// pg round trip without a credential behind it.
const byToken = new RateLimiter(120, 60_000);
const byIp = new RateLimiter(20, 60_000);
// Writes get their own, much tighter budget — see the call site in tools/call.
const byWrite = new RateLimiter(10, 60_000);

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

/** A 401 that says WHICH failure it is: without this header a client cannot
 *  tell "not authenticated" from "server broken", and retries forever. Full
 *  OAuth 2.1 discovery (RFC 9728) is deliberately deferred — this server takes
 *  a bearer token minted at /admin/mcp. */
const unauthorized = (message: string, version: string) =>
  json(rpcError(null, -32001, message), 401, {
    'WWW-Authenticate': 'Bearer realm="rafael-news", error="invalid_request"',
    'MCP-Protocol-Version': version,
  });

const INSTRUCTIONS = [
  'Rafael Ojeda News is a bilingual financial news portal (Spanish by default, English available).',
  'Every tool takes a `locale` argument; it defaults to the portal default language.',
  'Market figures returned by get_market are SAMPLE data, not a provider\'s live quotes:',
  'never present them as real-time prices.',
  'Writing stops at draft. A draft is invisible to readers — it is not on the front page,',
  'not in the feeds and not in search — and only a human editor publishes it in the newsroom.',
].join(' ');

export const POST: APIRoute = async ({ request, clientAddress, site }) => {
  // The version of the exchange. Absent header = the revision the spec says to
  // assume; `initialize` renegotiates from its own params below.
  const requested = request.headers.get('mcp-protocol-version');
  const version = requested ? negotiateVersion(requested) : FALLBACK_VERSION;

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY) {
    return json(rpcError(null, -32600, 'request body too large'), 413,
      { 'MCP-Protocol-Version': version });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientAddress || 'unknown';
  const token = parseBearer(request.headers.get('authorization'));

  // EVERY method needs the token, `initialize` and `tools/list` included: an
  // open tools/list hands a scanner the shape of the newsroom API for free.
  if (!token) {
    if (byIp.limited(ip)) return tooMany(version);
    return unauthorized('unauthorized: send Authorization: Bearer <token>', version);
  }

  if (!configured()) {
    console.error('[mcp] no DATABASE_URL: there is nothing to authenticate against');
    return json(rpcError(null, -32002, 'service unavailable'), 503,
      { 'MCP-Protocol-Version': version });
  }

  // BEFORE the pg round trip, and keyed by the hash rather than by the IP.
  // Ordering is the whole point: mcpPrincipalFromToken() draws from a pool of
  // three connections that also serves sessionFromToken and login, so a limiter
  // that runs *after* the query bounds nothing — a loop of garbage bearers with
  // no credential at all would saturate the pool and bounce every newsroom user
  // to /admin/entrar. An IP cannot carry this check either: `ip` below comes
  // from X-Forwarded-For, which the client writes. The hash costs no I/O and is
  // the one identifier an attacker cannot rotate for free.
  // Keyed by the hash and never by the token: a rate-limit map is not a place
  // to keep credentials.
  if (byToken.limited(hashToken(token))) return tooMany(version);

  let principal: McpPrincipal | null = null;
  try {
    principal = await mcpPrincipalFromToken(token);
  } catch (e) {
    console.error('[mcp] could not verify the key:', (e as Error).message);
    return json(rpcError(null, -32002, 'service unavailable'), 503,
      { 'MCP-Protocol-Version': version });
  }
  if (!principal) {
    if (byIp.limited(ip)) return tooMany(version);
    return unauthorized('unauthorized: unknown, revoked or expired key', version);
  }

  // The Content-Length check above is a courtesy that lets an honest client fail
  // fast; it is NOT the limit. The header is absent under chunked encoding and
  // can simply be wrong, and either way `Number(...)` compares false and lets the
  // body through. Measuring the text we actually received is what enforces it.
  const raw = await request.text().catch(() => null);
  if (raw === null) {
    return json(rpcError(null, -32700, 'parse error'), 400, { 'MCP-Protocol-Version': version });
  }
  if (raw.length > MAX_BODY) {
    return json(rpcError(null, -32600, 'request body too large'), 413,
      { 'MCP-Protocol-Version': version });
  }

  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return json(rpcError(null, -32700, 'parse error'), 400, { 'MCP-Protocol-Version': version });
  }
  // A body that parses but is a scalar (`5`, `"x"`, `null`) is well-formed JSON
  // and badly-formed JSON-RPC, which is -32600 and not -32700.
  if (message === null || typeof message !== 'object') {
    return json(rpcError(null, -32600, 'invalid request'), 400,
      { 'MCP-Protocol-Version': version });
  }
  if (Array.isArray(message)) {
    // Removed by the 2025-06-18 revision. Refused explicitly instead of
    // half-working on the first element.
    return json(rpcError(null, -32600, 'JSON-RPC batching is not supported'), 400,
      { 'MCP-Protocol-Version': version });
  }

  // Before any dispatch: a notification expects no response at all. This is
  // what makes `notifications/initialized` work, and it is the most commonly
  // botched line in a hand-rolled server.
  if (isNotification(message)) {
    return new Response(null, { status: 202, headers: { 'MCP-Protocol-Version': version } });
  }

  const msg = message as { id?: RpcId; method?: unknown; params?: unknown };
  const id = (msg.id ?? null) as RpcId;
  const method = String(msg.method ?? '');
  const params = (msg.params ?? {}) as Record<string, unknown>;
  const origin = site?.origin ?? new URL(request.url).origin;

  try {
    if (method === 'initialize') {
      const agreed = negotiateVersion(typeof params.protocolVersion === 'string'
        ? params.protocolVersion : undefined);
      return json(rpcResult(id, {
        protocolVersion: agreed,
        // No resources and no prompts: get_story already returns the whole
        // sanitised body, so a news:// resource would be the same bytes under a
        // second name, and a growing corpus would want pagination plus a
        // server-initiated stream this transport does not have.
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: 'rafael-news',
          title: 'Rafael Ojeda News',
          version: import.meta.env.PUBLIC_BUILD_COMMIT ?? '0.0.0',
        },
        // The only place to tell the model the three things it cannot infer.
        instructions: INSTRUCTIONS,
      }), 200, { 'MCP-Protocol-Version': agreed });
    }

    if (method === 'ping') {
      return json(rpcResult(id, {}), 200, { 'MCP-Protocol-Version': version });
    }

    if (method === 'tools/list') {
      // Filtered by the key's scopes: a read-only key must not even SEE
      // create_draft. A model that is shown a tool and then gets an
      // authorization error burns a turn and retries.
      const tools = visibleTools(principal).map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
      }));
      return json(rpcResult(id, { tools }), 200, { 'MCP-Protocol-Version': version });
    }

    if (method === 'tools/call') {
      const name = String(params.name ?? '');
      const tool = buildTools(LOCALES, DEFAULT_LOCALE).find((t) => t.name === name);
      if (!tool) {
        return json(rpcError(id, -32602, `unknown tool: ${name}`), 200,
          { 'MCP-Protocol-Version': version });
      }
      // Missing scope is NOT a protocol error: it is an answer the model can
      // act on ("ask for a key that can write"), so it travels as a normal
      // result with isError.
      if (!hasScope(principal.scopes, tool.scope)) {
        return json(rpcResult(id, toolError(
          `this key does not carry the ${tool.scope} scope, so it cannot call ${name}`,
        )), 200, { 'MCP-Protocol-Version': version });
      }
      // A write is far more expensive than its one row: the stories_bump and
      // story_i18n_bump triggers fire per statement regardless of status, so a
      // single create_draft makes every app instance reload the whole content
      // snapshot and bumps the ETag that caches every public page. At the 120/min
      // token budget one key would churn the readers' cache continuously. Ten a
      // minute is generous for drafting and keeps that lever out of reach.
      if (tool.scope === 'stories:write' && byWrite.limited(hashToken(token))) {
        return tooMany(version);
      }
      const checked = validateArgs(tool, params.arguments);
      // `=== false` and not `!checked.ok`: this tsconfig extends astro's base,
      // where strictNullChecks is off and truthiness does NOT narrow a
      // discriminated union — the comparison against the literal does.
      if (checked.ok === false) {
        return json(rpcError(id, -32602, checked.message), 200,
          { 'MCP-Protocol-Version': version });
      }
      const outcome = await runTool(name, checked.value, principal, origin);
      const result = isError(outcome) ? toolError(outcome.error) : toolResult(outcome.structured);
      return json(rpcResult(id, result), 200, { 'MCP-Protocol-Version': version });
    }

    return json(rpcError(id, -32601, `method not found: ${method}`), 200,
      { 'MCP-Protocol-Version': version });
  } catch (e) {
    // The message is logged, never returned: a stack trace is a map of the app.
    console.error(`[mcp] ${method} failed:`, (e as Error).message);
    return json(rpcError(id, -32603, 'internal error'), 200, { 'MCP-Protocol-Version': version });
  }
};

const tooMany = (version: string) =>
  json(rpcError(null, -32003, 'too many requests'), 429, { 'MCP-Protocol-Version': version });

const visibleTools = (principal: McpPrincipal): ToolDef[] =>
  buildTools(LOCALES, DEFAULT_LOCALE).filter((t) => hasScope(principal.scopes, t.scope));

/** Both shapes, not one: `structuredContent` is the 2025-06-18 form and
 *  `content` is what an older client reads. */
const toolResult = (structured: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(structured) }],
  structuredContent: structured,
});

/** "Story not found", "no permission", "that story is published": a normal
 *  result with `isError`, in plain English, which is what lets a model recover
 *  instead of dying. A malformed call is the other channel, a JSON-RPC error. */
const toolError = (text: string) => ({ content: [{ type: 'text', text }], isError: true });

// A GET here is almost always a person or a scanner poking at the URL. It gets
// something useful instead of a 404 that looks like a broken portal.
const notAllowed: APIRoute = () =>
  json({ message: 'POST JSON-RPC 2.0 here with Authorization: Bearer <token>. See /docs/mcp.md' },
    405, { Allow: 'POST' });

export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = notAllowed;
