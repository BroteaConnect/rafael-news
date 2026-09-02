// The pure half of the MCP server: the JSON-RPC envelope, version negotiation,
// scopes, the tool catalogue and the validator for a tool's arguments. No
// database, no network, no Astro — which is exactly what makes it the part that
// runs whole under `node --test` (src/locales/mcp.test.mjs).
//
// ZERO RELATIVE IMPORTS, and that is a hard requirement rather than a style
// preference: src/lib/load-ts.mjs strips the types with esbuild and imports the
// result as a `data:` URL, which only works for self-contained modules. It is
// the same constraint markdown.ts, dates.ts and newsletter/core.ts live under.
// That is why `buildTools()` takes the locale list as an ARGUMENT instead of
// importing src/locales/config.json — the trick `dayLabel()` uses in dates.ts —
// so adding a language stays a one-file change and this module stays testable.
//
// No npm dependency either: the envelope and the argument validation are
// hand-written, the same call this repo made for its Markdown renderer and for
// `scrypt` over argon2.

// -- Protocol versions ---------------------------------------------------------
// MCP has revised three times in a year: 2025-06-18 removed batching and added
// `structuredContent`, and the next revision will move again. One array, so a
// future version is one line and a test, not a hunt through the route.
export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26'] as const;

/** What the spec says to assume when a post-initialize request carries no
 *  `MCP-Protocol-Version` header. */
export const FALLBACK_VERSION = '2025-03-26';

/** Echo back the client's version when we speak it; otherwise answer with our
 *  latest. An unknown version gets a working server, not an error: a client
 *  that asks for 2024-11-05 can still call every tool here. */
export function negotiateVersion(requested?: string): string {
  const supported = SUPPORTED_VERSIONS as readonly string[];
  return requested && supported.includes(requested) ? requested : SUPPORTED_VERSIONS[0];
}

// -- Scopes --------------------------------------------------------------------
// The same two strings the SQL CHECK in 005_mcp_tokens.sql allows. A role says
// what a PERSON may do; a scope says what THIS KEY may do, and it can be
// strictly less.
export const SCOPES = ['content:read', 'stories:write'] as const;
export type Scope = (typeof SCOPES)[number];

export const hasScope = (scopes: readonly string[], scope: string): boolean =>
  scopes.includes(scope);

// -- Bearer --------------------------------------------------------------------
/** The token out of an `Authorization` header, or null. The scheme is compared
 *  case-insensitively (clients differ), and anything that is not exactly
 *  `<scheme> <token>` is rejected rather than guessed at. */
export function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  if (parts[0].toLowerCase() !== 'bearer') return null;
  return parts[1] || null;
}

// -- JSON-RPC 2.0 --------------------------------------------------------------
export type RpcId = string | number | null;

export interface RpcErrorBody { code: number; message: string; data?: unknown }
export interface RpcResponse {
  jsonrpc: '2.0';
  id: RpcId;
  result?: unknown;
  error?: RpcErrorBody;
}

/** A notification is a message with NO id — `!('id' in msg)`, never `!msg.id`.
 *  A JSON-RPC id of `0` is a perfectly valid id, and the falsy check is the
 *  classic bug: it turns a real request into a notification and the client
 *  waits for a response that never comes. */
export const isNotification = (msg: object): boolean => !('id' in msg);

export const rpcResult = (id: RpcId, result: unknown): RpcResponse =>
  ({ jsonrpc: '2.0', id, result });

/** The id travels back verbatim, falsy or not: `0` and `null` are ids. */
export const rpcError = (id: RpcId, code: number, message: string, data?: unknown): RpcResponse =>
  ({ jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } });

// -- Text folding --------------------------------------------------------------
/** Lower-case and accent-stripped, for `search_stories`: «Análisis» has to be
 *  found by typing `analisis`. The same normalisation `acceptInvite()` uses to
 *  build an author slug, without the hyphen collapsing of `slugify`. */
export const fold = (s: string): string =>
  String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// -- The tool catalogue --------------------------------------------------------
export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
  description?: string;
  enum?: readonly string[];
  default?: string | number | boolean;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  items?: JsonSchema;
}

export interface ObjectSchema extends JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchema>;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  /** What a key must carry to be allowed to call it. */
  scope: Scope;
  inputSchema: ObjectSchema;
  outputSchema: ObjectSchema;
}

const str = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema =>
  ({ type: 'string', description, ...extra });
const int = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema =>
  ({ type: 'integer', description, ...extra });

/**
 * The eight tools, built for the languages this portal actually publishes.
 *
 * `locales` and `defaultLocale` are ARGUMENTS: the `locale` enum of every
 * schema is generated from src/locales/config.json by the caller, never
 * hand-written here, so `brotea i18n add <code>` stays a one-file change — and
 * this module keeps its promise of importing nothing.
 *
 * One `list_stories` with `topic` / `author` / `day` filters instead of four
 * list tools: a long tool list is what makes a model pick the wrong one.
 */
export function buildTools(locales: readonly string[], defaultLocale: string): ToolDef[] {
  const locale = (): JsonSchema => ({
    type: 'string',
    description: `Language of the returned text (${locales.join(', ')}). Defaults to ${defaultLocale}.`,
    enum: [...locales],
    default: defaultLocale,
  });

  // The row every listing returns. Same shape everywhere so a model does not
  // have to learn two of them.
  const storyRow: ObjectSchema = {
    type: 'object',
    properties: {
      slug: str('URL slug of the story'),
      title: str('headline in the requested language'),
      standfirst: str('the two-line summary under the headline'),
      topicId: str('topic id: macro, markets, crypto or fx'),
      topicName: str('topic name in the requested language'),
      publishedAt: str('ISO-8601 UTC timestamp of publication'),
      url: str('absolute URL of the story on the public site'),
    },
  };

  const listOutput: ObjectSchema = {
    type: 'object',
    properties: {
      results: { type: 'array', description: 'the matching stories, newest first', items: storyRow },
      total: int('how many stories matched before limit and offset'),
    },
  };

  const draftOutput: ObjectSchema = {
    type: 'object',
    properties: {
      id: str('id of the story row'),
      status: str('always draft — no tool here publishes'),
      editUrl: str('absolute URL of the newsroom editor for this draft'),
    },
  };

  return [
    {
      name: 'search_stories',
      title: 'Search stories',
      scope: 'content:read',
      description: 'Full-text search over published headlines, standfirsts and topic names. '
        + 'Accent- and case-insensitive. Only published stories are searchable: drafts are '
        + 'invisible here by construction.',
      inputSchema: {
        type: 'object',
        properties: {
          query: str('what to look for; matched against headline, standfirst and topic', { minLength: 2 }),
          locale: locale(),
          limit: int('how many stories to return', { minimum: 1, maximum: 50, default: 10 }),
        },
        required: ['query'],
      },
      outputSchema: listOutput,
    },
    {
      name: 'list_stories',
      title: 'List stories',
      scope: 'content:read',
      description: 'Published stories, newest first, with optional filters. `day` is a calendar '
        + 'day in the outlet timezone (Europe/Madrid), not UTC. Use it to answer "what did the '
        + 'portal publish today" without searching.',
      inputSchema: {
        type: 'object',
        properties: {
          locale: locale(),
          topic: str('topic id (macro, markets, crypto, fx) or topic slug'),
          author: str('author id or author slug'),
          day: str('a single day as YYYY-MM-DD, in Europe/Madrid', { minLength: 10 }),
          limit: int('how many stories to return', { minimum: 1, maximum: 50, default: 20 }),
          offset: int('how many stories to skip, for paging', { minimum: 0, default: 0 }),
        },
      },
      outputSchema: listOutput,
    },
    {
      name: 'get_story',
      title: 'Get one story',
      scope: 'content:read',
      description: 'One published story by its slug, including the sanitised HTML body. '
        + 'A draft is not readable here: it has no slug and is not published.',
      inputSchema: {
        type: 'object',
        properties: { slug: str('the story slug, as returned by list_stories'), locale: locale() },
        required: ['slug'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          ...storyRow.properties,
          body: str('the story body as sanitised HTML, or an empty string if unwritten'),
          readingMinutes: int('estimated reading time in minutes'),
          relevance: str('editorial weight: high, medium or low'),
          author: {
            type: 'object',
            description: 'who signs the story',
            properties: { name: str('by-line'), slug: str('author slug'), role: str('how the author is presented') },
          },
        },
      },
    },
    {
      name: 'list_topics',
      title: 'List topics',
      scope: 'content:read',
      description: 'The portal sections with how many published stories each one carries.',
      inputSchema: { type: 'object', properties: { locale: locale() } },
      outputSchema: {
        type: 'object',
        properties: {
          topics: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: str('topic id'),
                slug: str('topic slug, the same in every language'),
                name: str('topic name in the requested language'),
                count: int('published stories in this topic'),
                url: str('absolute URL of the topic page'),
              },
            },
          },
        },
      },
    },
    {
      name: 'list_authors',
      title: 'List authors',
      scope: 'content:read',
      description: 'Who writes in this outlet, with their public biography and story count.',
      inputSchema: { type: 'object', properties: { locale: locale() } },
      outputSchema: {
        type: 'object',
        properties: {
          authors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: str('author id'),
                slug: str('author slug'),
                name: str('by-line'),
                role: str('how the author is presented, in the requested language'),
                bio: str('short biography in the requested language'),
                stories: int('published stories signed by this author'),
                url: str('absolute URL of the author page'),
              },
            },
          },
        },
      },
    },
    {
      name: 'get_market',
      title: 'Get the market bar',
      scope: 'content:read',
      description: 'The market snapshot shown in the site header. IMPORTANT: `sample` true means '
        + 'these are sample figures, not a provider\'s live quotes, and `stale` true means the '
        + 'snapshot is older than its declared delay. Never present either as a live quote.',
      inputSchema: { type: 'object', properties: { locale: locale() } },
      outputSchema: {
        type: 'object',
        properties: {
          quotes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: str('instrument id'),
                name: str('instrument name in the requested language'),
                value: { type: 'number', description: 'last value' },
                decimals: int('decimals this instrument quotes with'),
                changePct: { type: 'number', description: 'percentage change, signed' },
              },
            },
          },
          asOf: str('ISO-8601 UTC timestamp of the DATA, not of the request'),
          delayMinutes: int('delay declared by the provider'),
          sample: { type: 'boolean', description: 'true when these are sample figures, not real quotes' },
          stale: { type: 'boolean', description: 'true when the snapshot is older than its declared delay' },
        },
      },
    },
    {
      name: 'create_draft',
      title: 'Create a draft',
      scope: 'stories:write',
      description: 'Create a story as a DRAFT, signed by the owner of this key. A draft is '
        + 'invisible to readers: it never reaches the front page, the feeds or the search index. '
        + 'Only a human editor publishes, in the newsroom. Returns the id and the editor URL.',
      inputSchema: {
        type: 'object',
        properties: {
          title: str('the headline', { minLength: 1 }),
          standfirst: str('two lines saying why it matters', { minLength: 1 }),
          topic: str('topic id (macro, markets, crypto, fx) or topic slug', { minLength: 1 }),
          body_md: str('the body in Markdown. Supported: ## to ####, **bold**, *italic*, `code`, '
            + 'lists, > quotes and [links](url). Raw HTML is escaped, never rendered.'),
          locale: locale(),
        },
        required: ['title', 'standfirst', 'topic'],
      },
      outputSchema: draftOutput,
    },
    {
      name: 'update_draft',
      title: 'Update a draft',
      scope: 'stories:write',
      description: 'Edit one language of an existing DRAFT. Fields left out keep their current '
        + 'value. A published story is refused: pulling it off the site and re-editing it is a '
        + 'human decision taken in the newsroom.',
      inputSchema: {
        type: 'object',
        properties: {
          id: str('the story id returned by create_draft', { minLength: 1 }),
          title: str('new headline'),
          standfirst: str('new standfirst'),
          body_md: str('new body in Markdown'),
          topic: str('topic id or topic slug'),
          relevance: str('editorial weight', { enum: ['high', 'medium', 'low'] }),
          locale: locale(),
        },
        required: ['id'],
      },
      outputSchema: draftOutput,
    },
  ];
}

// -- Argument validation -------------------------------------------------------
export type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * Checks a tool call's arguments against its own `inputSchema` and fills in the
 * declared defaults. Hand-rolled over the handful of keywords the schemas above
 * use (`type`, `required`, `enum`, `minLength`, `minimum`, `maximum`) instead of
 * pulling in a JSON-Schema library: `unlisted_deps` and the dependency-cycle
 * rule are both budgeted at 0, and a validator this small is easier to read
 * than the configuration of a general one.
 *
 * Unknown arguments are ignored rather than rejected. A model that adds a field
 * should get its answer, not a lecture.
 */
export function validateArgs(tool: ToolDef, args: unknown): ValidationResult {
  if (args !== undefined && args !== null && (typeof args !== 'object' || Array.isArray(args))) {
    return { ok: false, message: 'arguments must be an object' };
  }
  const input = (args ?? {}) as Record<string, unknown>;
  const required = tool.inputSchema.required ?? [];
  const out: Record<string, unknown> = {};

  for (const [name, schema] of Object.entries(tool.inputSchema.properties)) {
    const raw = input[name];
    if (raw === undefined || raw === null) {
      if (required.includes(name)) return { ok: false, message: `missing required argument '${name}'` };
      if (schema.default !== undefined) out[name] = schema.default;
      continue;
    }

    if (schema.type === 'string') {
      if (typeof raw !== 'string') return { ok: false, message: `'${name}' must be a string` };
      const value = raw;
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        return { ok: false, message: `'${name}' must be at least ${schema.minLength} characters` };
      }
      if (schema.enum && !schema.enum.includes(value)) {
        return { ok: false, message: `'${name}' must be one of: ${schema.enum.join(', ')}` };
      }
      out[name] = value;
      continue;
    }

    if (schema.type === 'integer' || schema.type === 'number') {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return { ok: false, message: `'${name}' must be a number` };
      }
      if (schema.type === 'integer' && !Number.isInteger(raw)) {
        return { ok: false, message: `'${name}' must be a whole number` };
      }
      if (schema.minimum !== undefined && raw < schema.minimum) {
        return { ok: false, message: `'${name}' must be ${schema.minimum} or more` };
      }
      if (schema.maximum !== undefined && raw > schema.maximum) {
        return { ok: false, message: `'${name}' must be ${schema.maximum} or less` };
      }
      out[name] = raw;
      continue;
    }

    if (schema.type === 'boolean') {
      if (typeof raw !== 'boolean') return { ok: false, message: `'${name}' must be true or false` };
      out[name] = raw;
      continue;
    }

    out[name] = raw;
  }

  return { ok: true, value: out };
}
