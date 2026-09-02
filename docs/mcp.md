# MCP server

Claude — running in somebody else's client — can read this portal and write
drafts in it. That makes the portal a **remote** MCP server: JSON-RPC 2.0 over
`POST /api/mcp`, served by the same Astro process that serves the site. No
second container, no second deployment, no extra environment variable.

```
src/lib/mcp/protocol.ts   the pure half: envelope, versions, scopes, tools, validation
src/lib/mcp/tools.ts      what the eight tools do against the portal
src/pages/api/mcp.ts      the endpoint: auth, rate limits, dispatch
src/pages/admin/mcp.astro where a key is minted and revoked
src/migrations/005_mcp_tokens.sql  the mcp_tokens table
src/locales/mcp.test.mjs  the tests for protocol.ts
```

## Endpoint

| | |
| --- | --- |
| URL | `https://rafael-news.brotea.dev/api/mcp` |
| Method | `POST` only. `GET` / `DELETE` / `OPTIONS` answer `405` with `Allow: POST` |
| Auth | `Authorization: Bearer mcp_…` on **every** call, `initialize` and `tools/list` included |
| Body | one JSON-RPC 2.0 message. **Batches are refused** (`-32600`) — the 2025-06-18 revision removed them |
| Response | always `application/json`, `Cache-Control: no-store`, plus `MCP-Protocol-Version` |
| Max body | 128 KB → `413` |

### Transport decisions

- **JSON, never SSE.** Every request gets one JSON response, which the spec
  permits. There is no server-initiated stream, so there are no
  `notifications/*` from us and no `listChanged` events.
- **Stateless.** No `Mcp-Session-Id` is issued or required. It is the only mode
  that survives a container restart in the middle of a conversation.
- **Versions:** `2025-06-18` (preferred) and `2025-03-26`. `initialize` echoes
  the client's version when we speak it and answers with our latest when we do
  not — an unknown version gets a working server, not an error. A request with
  no `MCP-Protocol-Version` header is treated as `2025-03-26`, as the spec says.
- **A notification (a message with no `id`) gets `202` and an empty body**,
  before any dispatch. That is what makes `notifications/initialized` work.
- **Capabilities: tools only** (`{ "tools": { "listChanged": false } }`). No
  resources: `get_story` already returns the whole sanitised body, so a
  `news://story/<slug>` resource would be the same bytes under a second name,
  and a growing corpus would want pagination plus the server-initiated stream
  this transport deliberately does not have. No prompts either.
- **No CORS header is emitted and no `Origin` is ever compared.** Without
  `Access-Control-Allow-Origin`, no browser page on any origin can attach an
  `Authorization` header to this route, which is the DNS-rebinding mitigation
  that fits a bearer-authenticated remote server. Origin allow-listing is
  refused rather than merely unimplemented: behind the node adapter
  `url.origin` is `http://localhost` while the browser sends the real domain,
  which is exactly why `checkOrigin: false` is set in `astro.config.mjs` after
  every newsroom form answered `403`. Re-adding an origin comparison re-adds
  that bug.

### Errors, on two channels

They are not interchangeable, and the difference is what lets a model recover:

| Channel | Used for | Shape |
| --- | --- | --- |
| JSON-RPC `error` | unknown method (`-32601`), unknown tool or invalid arguments (`-32602`), unparseable body (`-32700`), batch (`-32600`), unauthorized (`-32001`), unavailable (`-32002`), rate limited (`-32003`), internal (`-32603`) | `{"jsonrpc":"2.0","id":…,"error":{"code":…,"message":…}}` |
| A normal result with `isError` | "no story with that slug", "this key cannot write", "that story is published" | `{"content":[{"type":"text","text":"…"}],"isError":true}` |

A successful `tools/call` returns **both** shapes of payload:
`structuredContent` (the 2025-06-18 form) and a `content` array whose text is
the same JSON, which is what an older client reads.

## Authentication

Dedicated `mcp_tokens` rows, not session cookies. MCP clients send
`Authorization: Bearer`, never cookies — and beyond that a session token is the
browser's key to the *whole* newsroom, it slides 30 days and it dies on a
password reset. A connector with that lifetime is the wrong shape.

| Property | Value |
| --- | --- |
| Token | `mcp_` + 32 random bytes, base64url. The prefix is for secret scanners and for whoever finds the string in a config file |
| Stored | `sha256(token)` hex, compared with `timingSafeEqual`. **The clear token exists once**, on the screen that created it |
| Scopes | `content:read` (always) and optionally `stories:write`. Enforced in TypeScript *and* by a `CHECK` in the table |
| Expiry | chosen when minting: 30 / 90 / 365 days or never. Default 90 |
| Revocation | one click at `/admin/mcp`; effective on the very next request |
| Also refused | a suspended user's keys (`users.status`), because the lookup joins `users` and checks it |
| Usage | `last_used_at` is refreshed at most once every five minutes, so a chatty client does not turn every call into a write |

A `401` carries `WWW-Authenticate: Bearer realm="rafael-news",
error="invalid_request"`, which is what lets a client tell "not authenticated"
from "server broken".

**OAuth is deliberately deferred.** There is no authorization server, no
dynamic client registration and no RFC 9728 protected-resource metadata. This
server works wherever a static header can be configured — Claude Code, a
desktop client's JSON config, `curl`. A connector UI that *requires* an OAuth
flow will not auto-negotiate against it.

**Rate limits** (in memory, per process, sliding window, like the newsletter's):
120 requests per minute per key, of which at most 10 may be `create_draft` or
`update_draft`, plus 20 per minute per IP for requests that fail to
authenticate.

The per-key check runs **before** the database is touched, and the writing
budget is separate and much tighter, both for the same reason. The key check
comes first because the key lookup draws on a pool of three connections shared
with the newsroom's own sessions: a limiter that ran after the query would let
a loop of invalid keys — no credential needed — exhaust that pool and lock
editors out of `/admin`. It is keyed by the token's hash and not by the IP
because `X-Forwarded-For` is written by the client. Writes are capped low
because each one fires the content triggers: the snapshot reloads on every
instance and the ETag that caches every public page moves, so a write is far
more expensive than the row it stores.

## Minting a key

`/admin/mcp`, in the newsroom (`mcp:token`, which every role has). A key is
always minted **for whoever is signed in** — never on behalf of somebody else —
so what it writes carries their by-line and is audited with their id.

1. Name it after where it will live ("claude desktop, laptop"). Without a name,
   a list of four hashes cannot be revoked with any confidence.
2. Pick an expiry. 90 days by default; the primary control is revocation.
3. Leave writing off unless the key needs it. Reading is always on.
4. Copy the token. It is shown **once** and never again.

**Rotation** is "mint the new one, repoint the client, revoke the old", with no
downtime: several named keys per user are supported. There is no scheduled
sweep of expired rows — an expired row is already refused.

Audited actions: `mcp.token.issued`, `mcp.token.revoked`, `mcp.draft.created`,
`mcp.draft.updated`.

## Connecting a client

Claude Code:

```bash
claude mcp add --transport http rafael-news \
  https://rafael-news.brotea.dev/api/mcp \
  --header "Authorization: Bearer mcp_…"
```

A desktop client's config file:

```json
{
  "mcpServers": {
    "rafael-news": {
      "type": "http",
      "url": "https://rafael-news.brotea.dev/api/mcp",
      "headers": { "Authorization": "Bearer mcp_…" }
    }
  }
}
```

## The eight tools

`L` below is the `locale` argument every tool takes: one of the published
languages, defaulting to the portal's default (`es`). Its `enum` is **generated
from `src/locales/config.json`**, so `brotea i18n add <code>` needs no edit
here.

| Tool | Scope | Input | Output |
| --- | --- | --- | --- |
| `search_stories` | `content:read` | `query` *(≥2 chars, required)*, `locale` `L`, `limit` *(1–50, default 10)* | `{ results: [row], total }` |
| `list_stories` | `content:read` | `locale` `L`, `topic` *(id or slug)*, `author` *(id or slug)*, `day` *(`YYYY-MM-DD`)*, `limit` *(1–50, default 20)*, `offset` *(≥0)* | `{ results: [row], total }`, newest first |
| `get_story` | `content:read` | `slug` *(required)*, `locale` `L` | a row plus `body` (sanitised HTML), `readingMinutes`, `relevance`, `author {name,slug,role}` |
| `list_topics` | `content:read` | `locale` `L` | `{ topics: [{id,slug,name,count,url}] }` |
| `list_authors` | `content:read` | `locale` `L` | `{ authors: [{id,slug,name,role,bio,stories,url}] }` |
| `get_market` | `content:read` | `locale` `L` | `{ quotes:[{id,name,value,decimals,changePct}], asOf, delayMinutes, sample, stale }` |
| `create_draft` | `stories:write` | `title`*, `standfirst`*, `topic`*, `body_md`, `locale` `L` | `{ id, status:'draft', editUrl }` |
| `update_draft` | `stories:write` | `id`*, `title`, `standfirst`, `body_md`, `topic`, `relevance`, `locale` `L` | `{ id, status, editUrl }` |

A **row** is `{ slug, title, standfirst, topicId, topicName, publishedAt, url }`.
`url` is absolute: a model quoting a story should quote a link that works.

`tools/list` is **filtered by the key's scopes**: a read-only key does not even
see `create_draft`. A model shown a tool it cannot call burns a turn and retries.

Notes that are decisions, not omissions:

- **One `list_stories` with filters instead of four list tools.** Tool-list
  bloat is what makes a model pick the wrong one.
- **`day` is a calendar day in Europe/Madrid**, computed with `dayKey()` from
  `src/lib/dates.ts`. Grouping in UTC files a 23:30 Madrid story under the next
  day.
- **`get_market` exists so `sample` and `stale` reach the model.** The figures
  are sample data, not a provider's quotes, and a model presenting them as live
  prices on a financial site would be a lie with our name on it. `initialize`
  says so in its `instructions` too.
- **Read tools never touch Postgres.** They go through the accessors of
  `src/lib/content/store.ts`, i.e. the in-memory snapshot, so an MCP client
  keeps answering during a database restart. `update_draft` reads through
  `getDraft()` (Postgres), never the snapshot.
- **A freshly created draft is not findable with `get_story`**, by design: the
  snapshot only carries published stories. `create_draft` returns the `id` and
  the `editUrl`; use those.
- **`update_draft` merges.** Fields the call leaves out keep the value stored in
  `story_i18n` — `SaveInput` has no optional fields, so passing `undefined`
  would blank the row.

### What no tool can do

- **Publish or unpublish.** There is no such tool and there will not be one
  here. `publish()` computes the permanent slug, moves the single `lead` under a
  partial unique index and puts the story on the front page within one
  `pg_notify`; that is a decision for the desk, taken in `/admin`.
- **Edit anything that is not a draft.** `update_draft` takes a draft and
  refuses every other status — published, and also `scheduled` and `archived`,
  which the schema allows even though nothing sets them yet. For a published
  story the content trigger would make an unreviewed edit live in under a second
  with no diff anyone saw; for a scheduled one it would do the same on a timer.
  The check is an allow-list so that a future scheduling feature cannot quietly
  widen what a key may rewrite.
- **Edit somebody else's story** without `story:any` — the same per-story check
  `src/pages/admin/noticias/[id].astro` performs.
- **Touch `newsletter_subscribers`, `users`, `invites`, `sessions` or
  `audit_log`.** Deliberate exclusions: the public surface of this outlet must
  never become a checker for who reads it or who writes for it.

## Degraded modes

| Situation | Behaviour |
| --- | --- |
| No `DATABASE_URL` | `503` with `-32002`: there is nothing to authenticate against and there is no seed to pretend with, the same degraded mode `POST /api/newsletter` has. This is why `npm run gate:web`, which blanks `DATABASE_URL`, never calls this route |
| Postgres unreachable | `503` as well; the public site keeps serving from the snapshot |
| Snapshot stale (the `LISTEN` connection is down) | Read tools answer from the last snapshot. Every row carries `publishedAt` and `get_market` carries `stale`, so the age is visible rather than implied. The listener retries every 5 s |

## A session, end to end

```bash
TOKEN=mcp_…
URL=https://rafael-news.brotea.dev/api/mcp

curl -s -X POST $URL -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
# {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18",
#   "capabilities":{"tools":{"listChanged":false}},
#   "serverInfo":{"name":"rafael-news","title":"Rafael Ojeda News","version":"<commit>"},
#   "instructions":"Rafael Ojeda News is a bilingual financial news portal …"}}

curl -s -X POST $URL -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' -o /dev/null -w '%{http_code}\n'
# 202

curl -s -X POST $URL -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
# {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"search_stories",…}]}}

curl -s -X POST $URL -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_stories","arguments":{"query":"bce","limit":3}}}'
# {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{\"results\":[…],\"total\":1}"}],
#   "structuredContent":{"results":[{"slug":"bce-tipos-septiembre","title":"…","url":"https://rafael-news.brotea.dev/noticia/bce-tipos-septiembre"}],"total":1}}}

curl -s -X POST $URL -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"create_draft","arguments":{"title":"Titular","standfirst":"Por qué importa","topic":"macro","body_md":"## Contexto\n\nTexto."}}}'
# {"jsonrpc":"2.0","id":4,"result":{"content":[…],
#   "structuredContent":{"id":"st-…","status":"draft","editUrl":"https://rafael-news.brotea.dev/admin/noticias/st-…"}}}
```

## Data model

`src/migrations/005_mcp_tokens.sql`, applied at boot like every other migration
(see [deployment.md](./deployment.md#migrations)). Numbered `005` because `004`
belongs to the story-video feature.

| Column | Notes |
| --- | --- |
| `id` | `bigint GENERATED ALWAYS AS IDENTITY` PK |
| `user_id` | → `users(id)` `ON DELETE CASCADE`. A key always acts as a person |
| `name` | `NOT NULL`, non-blank |
| `token_hash` | `NOT NULL UNIQUE`, sha256 hex. The clear token is never stored |
| `scopes` | `text[]`, default `{content:read}`, `CHECK (scopes <@ ARRAY['content:read','stories:write'])` and at least one |
| `created_at`, `expires_at` (`NULL` = never), `last_used_at`, `revoked_at` | `timestamptz` |

Partial index on `user_id WHERE revoked_at IS NULL`: only live keys are ever
listed.

## Testing

`src/locales/mcp.test.mjs` runs under `node --test` against `protocol.ts`
alone — which is why that module has **zero relative imports** and takes the
locale list as an argument (`src/lib/load-ts.mjs` only handles self-contained
modules). It asserts, above everything else, that exactly `create_draft` and
`update_draft` carry `stories:write` and that every other tool is
`content:read`: that single assertion is what stops a write tool from silently
becoming public in a later edit. It also covers the id-of-`0` notification trap,
bearer parsing, version negotiation, the schema/locale coupling and the
argument validator.

What a test cannot cover without a database — the merge in `update_draft`, the
scope `CHECK`, revocation and suspension — is verified by hand against a scratch
Postgres before release.
