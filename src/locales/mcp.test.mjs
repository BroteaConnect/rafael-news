// The MCP server's pure half. What is tested here is what cannot be wrong: a
// write tool that quietly becomes reachable by a read-only key, an id of `0`
// mistaken for a notification, a token parsed out of a header that is not one.
//
// It lives in src/locales/ because that is the path `npm test` walks
// (`node --test src/locales/*.test.mjs`); its natural home would be src/lib/.
// `loadTs` only handles self-contained modules, which is exactly why
// protocol.ts has no relative imports and takes the locale list as an argument.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from '../lib/load-ts.mjs';

const {
  SCOPES, buildTools, fold, hasScope, isNotification, negotiateVersion,
  parseBearer, rpcError, validateArgs,
} = await loadTs(new URL('../lib/mcp/protocol.ts', import.meta.url));

const LOCALES = ['es', 'en'];
const TOOLS = buildTools(LOCALES, 'es');
const tool = (name) => {
  const found = TOOLS.find((t) => t.name === name);
  assert.ok(found, `there is no tool named '${name}'`);
  return found;
};

test('writing is a separate scope: exactly two tools ask for it', () => {
  // The one assertion that stops a write tool from silently becoming public in
  // a later edit: move create_draft to the read scope and this fails here,
  // not in production.
  assert.deepEqual(
    TOOLS.filter((t) => t.scope === 'stories:write').map((t) => t.name),
    ['create_draft', 'update_draft'],
  );
  for (const t of TOOLS) {
    assert.ok(SCOPES.includes(t.scope), `${t.name}: unknown scope '${t.scope}'`);
    if (t.name !== 'create_draft' && t.name !== 'update_draft') {
      assert.equal(t.scope, 'content:read', `${t.name} must not be able to write`);
    }
  }
});

test('there is no publishing tool at all', () => {
  const names = TOOLS.map((t) => t.name);
  for (const forbidden of ['publish_story', 'unpublish_story', 'publish', 'delete_story']) {
    assert.ok(!names.includes(forbidden), `${forbidden} cannot exist: publishing is a human decision`);
  }
});

test('the scopes are the ones the SQL CHECK accepts', () => {
  assert.deepEqual([...SCOPES], ['content:read', 'stories:write']);
});

test('hasScope hands out nothing it was not given', () => {
  assert.equal(hasScope(['content:read'], 'content:read'), true);
  assert.equal(hasScope(['content:read'], 'stories:write'), false);
  assert.equal(hasScope([], 'content:read'), false);
  assert.equal(hasScope(['content:read', 'stories:write'], 'stories:write'), true);
});

test('parseBearer accepts a Bearer token and nothing else', () => {
  assert.equal(parseBearer('Bearer abc'), 'abc');
  assert.equal(parseBearer('bearer abc'), 'abc', 'the scheme is case-insensitive');
  assert.equal(parseBearer('BEARER abc'), 'abc');
  assert.equal(parseBearer('  Bearer   abc  '), 'abc');
  for (const bad of ['Basic abc', 'Bearer', 'Bearer a b', '', null, 'abc']) {
    assert.equal(parseBearer(bad), null, `should be rejected: ${JSON.stringify(bad)}`);
  }
});

test('a notification is the message with NO id, even when the id is 0', () => {
  assert.equal(isNotification({ jsonrpc: '2.0', method: 'notifications/initialized' }), true);
  assert.equal(isNotification({ jsonrpc: '2.0', id: 0, method: 'ping' }), false,
    'an id of 0 is an id: `!msg.id` is the classic bug');
  assert.equal(isNotification({ jsonrpc: '2.0', id: null, method: 'ping' }), false);
  assert.equal(isNotification({ jsonrpc: '2.0', id: 1, method: 'ping' }), false);
});

test('the id travels back verbatim, falsy or not', () => {
  assert.equal(rpcError(0, -32601, 'x').id, 0);
  assert.equal(rpcError(null, -32601, 'x').id, null);
  assert.equal(rpcError('abc', -32601, 'x').id, 'abc');
  const e = rpcError(7, -32601, 'method not found');
  assert.equal(e.jsonrpc, '2.0');
  assert.deepEqual(e.error, { code: -32601, message: 'method not found' });
  assert.deepEqual(rpcError(7, -1, 'x', { why: 'z' }).error.data, { why: 'z' });
});

test('the protocol version is negotiated, and an unknown one still works', () => {
  assert.equal(negotiateVersion('2025-06-18'), '2025-06-18');
  assert.equal(negotiateVersion('2025-03-26'), '2025-03-26');
  assert.equal(negotiateVersion('2024-11-05'), '2025-06-18', 'an unknown version gets our latest');
  assert.equal(negotiateVersion(undefined), '2025-06-18');
  assert.equal(negotiateVersion(''), '2025-06-18');
});

test('every tool can be advertised: name, description and both schemas', () => {
  assert.equal(TOOLS.length, 8);
  const names = TOOLS.map((t) => t.name);
  assert.deepEqual([...new Set(names)].sort(), [...names].sort(), 'duplicate tool names');
  for (const t of TOOLS) {
    assert.match(t.name, /^[a-z][a-z0-9_]*$/, `${t.name}: a name a client will not accept`);
    assert.ok(t.title.trim().length > 0, `${t.name}: no title`);
    assert.ok(t.description.trim().length > 20, `${t.name}: no usable description`);
    assert.equal(t.inputSchema.type, 'object', `${t.name}: inputSchema is not an object`);
    assert.ok(t.inputSchema.properties, `${t.name}: inputSchema has no properties`);
    assert.ok(t.outputSchema, `${t.name}: no outputSchema`);
    assert.equal(t.outputSchema.type, 'object', `${t.name}: outputSchema is not an object`);
  }
});

test('adding a language is editing config.json, not the tools', () => {
  for (const t of TOOLS) {
    const locale = t.inputSchema.properties.locale;
    assert.ok(locale, `${t.name}: takes no locale`);
    assert.deepEqual(locale.enum, LOCALES, `${t.name}: the enum is not built from the argument`);
    assert.equal(locale.default, 'es', `${t.name}: the default is not built from the argument`);
  }
  const others = buildTools(['fr', 'de'], 'fr');
  assert.deepEqual(others[0].inputSchema.properties.locale.enum, ['fr', 'de']);
  assert.equal(others[0].inputSchema.properties.locale.default, 'fr');
});

test('validateArgs: search_stories demands a real query', () => {
  const t = tool('search_stories');
  assert.equal(validateArgs(t, {}).ok, false, 'no query, no search');
  assert.equal(validateArgs(t, { query: 'a' }).ok, false, 'one letter searches the whole portal');
  assert.equal(validateArgs(t, { query: 'bce', limit: 0 }).ok, false);
  assert.equal(validateArgs(t, { query: 'bce', limit: 51 }).ok, false);
  assert.equal(validateArgs(t, { query: 'bce', limit: 'abc' }).ok, false);
  assert.equal(validateArgs(t, { query: 'bce', limit: 2.5 }).ok, false);
  assert.equal(validateArgs(t, { query: 'bce', locale: 'fr' }).ok, false, 'fr is not published');
  assert.equal(validateArgs(t, { query: 42 }).ok, false);
  assert.equal(validateArgs(t, 'not an object').ok, false);

  const ok = validateArgs(t, { query: 'bce' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { query: 'bce', locale: 'es', limit: 10 }, 'defaults were not filled in');
});

test('validateArgs: list_stories bounds and defaults', () => {
  const t = tool('list_stories');
  const ok = validateArgs(t, {});
  assert.equal(ok.ok, true, 'listing with no filter is valid');
  assert.deepEqual(ok.value, { locale: 'es', limit: 20, offset: 0 });
  assert.equal(validateArgs(t, { offset: -1 }).ok, false);
  assert.equal(validateArgs(t, { limit: 50, offset: 0 }).ok, true);
  assert.equal(validateArgs(t, { day: '2026-09-02' }).ok, true);
});

test('validateArgs: a draft with no headline is not a draft', () => {
  const t = tool('create_draft');
  assert.equal(validateArgs(t, { standfirst: 'x', topic: 'macro' }).ok, false, 'no title');
  assert.equal(validateArgs(t, { title: 'x', topic: 'macro' }).ok, false, 'no standfirst');
  assert.equal(validateArgs(t, { title: 'x', standfirst: 'y' }).ok, false, 'no topic');
  const ok = validateArgs(t, { title: 'Headline', standfirst: 'Standfirst', topic: 'macro' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.locale, 'es');

  const u = tool('update_draft');
  assert.equal(validateArgs(u, {}).ok, false, 'without an id nobody knows what is being edited');
  assert.equal(validateArgs(u, { id: 'st-1', relevance: 'invented' }).ok, false);
  const partial = validateArgs(u, { id: 'st-1', title: 'Another' });
  assert.equal(partial.ok, true);
  assert.equal(partial.value.standfirst, undefined,
    'what was not sent is not invented: the merge with the stored draft happens in tools.ts');
});

test('fold drops accents and case, which is how people actually search', () => {
  assert.ok(fold('BCE Septiembre').includes('septiembre'));
  assert.equal(fold('Análisis'), 'analisis');
  assert.equal(fold('CRIPTO'), 'cripto');
  assert.equal(fold(''), '');
});
