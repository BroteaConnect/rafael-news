// What the eight tools actually do. protocol.ts declares them and validates
// their arguments; here they are executed against the portal.
//
// Two properties this file is built to keep:
//
//  1. **A read tool never touches Postgres.** Every read goes through the
//     accessors of content/store.ts, i.e. through the in-memory snapshot, which
//     is the same property every public page is built on — and the reason an MCP
//     client keeps answering during a database restart.
//  2. **A write stops at `draft`.** There is no publish tool and there will not
//     be one here: saveStory() fires the content trigger, so an unreviewed edit
//     to a published story would be live in under a second with no diff anyone
//     saw. Publishing stays a human decision taken in /admin.
import {
  getArticles, getAuthors, getMarket, getStory, getTopics, isStale, localize,
} from '../content/store';
import {
  TOPICS, type Relevance, type StoryView, type TopicId, type TopicView,
} from '../content/types';
import { createStory, discardEmptyStory, getDraft, saveStory } from '../newsroom/store';
import { can } from '../auth/core';
import { audit, type McpPrincipal } from '../auth/store';
import { dayKey } from '../dates';
import { DEFAULT_LOCALE, localePath, type Locale } from '../i18n';
import { fold, hasScope } from './protocol';

/** Either a payload for `structuredContent`, or a refusal the model can read
 *  and recover from. The caller turns the second into a result with
 *  `isError: true`, never into a JSON-RPC error: "no such story" is an answer,
 *  not a broken call. */
export type ToolOutcome = { structured: unknown } | { error: string };

export const isError = (out: ToolOutcome): out is { error: string } => 'error' in out;

const abs = (origin: string, path: string): string => new URL(path, origin).href;

const storyUrl = (origin: string, locale: Locale, slug: string): string =>
  abs(origin, localePath(locale, `/noticia/${slug}`));

/** The row every listing returns. One shape, so a model does not have to learn
 *  two of them, and always with `publishedAt` so it can see how old the corpus
 *  it is quoting really is. */
const rowOf = (story: StoryView, locale: Locale, origin: string) => ({
  slug: story.slug,
  title: story.title,
  standfirst: story.standfirst,
  topicId: story.topicId,
  topicName: story.topicName,
  publishedAt: story.publishedAt,
  url: storyUrl(origin, locale, story.slug),
});

/** A topic given by id or by slug. The slug is translated content
 *  (`mercados`, not `markets`), so both have to be accepted or a model that
 *  read `list_topics` cannot filter with what it just read. */
const resolveTopic = (value: string, topics: TopicView[]): TopicId | null => {
  const wanted = fold(value.trim());
  const match = topics.find((t) => fold(t.id) === wanted || fold(t.slug) === wanted);
  if (match) return match.id;
  return (TOPICS as readonly string[]).includes(value) ? (value as TopicId) : null;
};

const topicHelp = (topics: TopicView[]): string =>
  topics.map((t) => `${t.id} (${t.slug})`).join(', ');

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * Runs one already-validated tool call. `origin` arrives from the route
 * (`Astro.site`) because absolute URLs are half the value of an answer: a model
 * quoting a story to a reader should quote a link that works, and this module
 * has no way of knowing the public domain on its own.
 */
export async function runTool(
  name: string, args: Record<string, unknown>, principal: McpPrincipal, origin: string,
): Promise<ToolOutcome> {
  // validateArgs already filled the default, but a caller that skips it must
  // not end up writing a story_i18n row under an empty locale.
  const locale = (str(args.locale) ?? DEFAULT_LOCALE) as Locale;

  switch (name) {
    case 'search_stories': return searchStories(args, locale, origin);
    case 'list_stories': return listStories(args, locale, origin);
    case 'get_story': return getOneStory(args, locale, origin);
    case 'list_topics': return listTopics(locale, origin);
    case 'list_authors': return listAuthors(locale, origin);
    case 'get_market': return getMarketBar(locale);
    case 'create_draft': return createDraft(args, locale, principal, origin);
    case 'update_draft': return updateDraft(args, locale, principal, origin);
    default: return { error: `unknown tool: ${name}` };
  }
}

// -- Read tools ----------------------------------------------------------------

async function searchStories(
  args: Record<string, unknown>, locale: Locale, origin: string,
): Promise<ToolOutcome> {
  const query = fold(String(args.query ?? ''));
  const limit = Number(args.limit ?? 10);
  const stories = await getArticles(locale);
  const matches = stories.filter((s) =>
    fold(`${s.title} ${s.standfirst} ${s.topicName}`).includes(query));
  return {
    structured: {
      results: matches.slice(0, limit).map((s) => rowOf(s, locale, origin)),
      total: matches.length,
    },
  };
}

async function listStories(
  args: Record<string, unknown>, locale: Locale, origin: string,
): Promise<ToolOutcome> {
  const stories = await getArticles(locale);
  const topics = await getTopics(locale);

  let filtered = stories;

  const topic = str(args.topic);
  if (topic) {
    const topicId = resolveTopic(topic, topics);
    if (!topicId) return { error: `unknown topic '${topic}'. Valid topics: ${topicHelp(topics)}` };
    filtered = filtered.filter((s) => s.topicId === topicId);
  }

  const author = str(args.author);
  if (author) {
    const wanted = fold(author.trim());
    filtered = filtered.filter((s) => fold(s.author.id) === wanted || fold(s.author.slug) === wanted);
  }

  const day = str(args.day);
  if (day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: `'day' must be YYYY-MM-DD, got '${day}'` };
    // Europe/Madrid, never UTC: grouping in UTC files a 23:30 Madrid story
    // under the following day, which is exactly the bug src/lib/dates.ts and
    // its test exist to prevent.
    filtered = filtered.filter((s) => dayKey(s.publishedAt) === day);
  }

  const offset = Number(args.offset ?? 0);
  const limit = Number(args.limit ?? 20);
  return {
    structured: {
      results: filtered.slice(offset, offset + limit).map((s) => rowOf(s, locale, origin)),
      total: filtered.length,
    },
  };
}

async function getOneStory(
  args: Record<string, unknown>, locale: Locale, origin: string,
): Promise<ToolOutcome> {
  const slug = String(args.slug ?? '');
  const story = await getStory(slug, locale);
  if (!story) {
    return {
      error: `no published story with slug '${slug}'. Use list_stories or search_stories to find `
        + 'one; a draft has no public slug and cannot be read here.',
    };
  }
  return {
    structured: {
      ...rowOf(story, locale, origin),
      body: story.body,
      readingMinutes: story.readingMinutes,
      relevance: story.relevance,
      author: { name: story.author.name, slug: story.author.slug, role: story.author.role },
    },
  };
}

async function listTopics(locale: Locale, origin: string): Promise<ToolOutcome> {
  const topics = await getTopics(locale);
  return {
    structured: {
      topics: topics.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        count: t.count,
        url: abs(origin, localePath(locale, `/tema/${t.slug}`)),
      })),
    },
  };
}

async function listAuthors(locale: Locale, origin: string): Promise<ToolOutcome> {
  const authors = await getAuthors(locale);
  const stories = await getArticles(locale);
  return {
    structured: {
      authors: authors.map((a) => ({
        id: a.id,
        slug: a.slug,
        name: a.name,
        role: a.role,
        bio: a.bio,
        stories: stories.filter((s) => s.author.id === a.id).length,
        url: abs(origin, localePath(locale, `/autor/${a.slug}`)),
      })),
    },
  };
}

async function getMarketBar(locale: Locale): Promise<ToolOutcome> {
  const market = await getMarket();
  // `sample` and `stale` travel with the data on purpose: MarketSnapshot.sample
  // says these are sample figures and not a provider's, and a model presenting
  // them as live quotes on a financial site would be a lie with our name on it.
  return {
    structured: {
      quotes: market.quotes.map((q) => ({
        id: q.id,
        name: localize(q.name, locale),
        value: q.value,
        decimals: q.decimals,
        changePct: q.changePct,
      })),
      asOf: market.asOf,
      delayMinutes: market.delayMinutes,
      sample: market.sample,
      stale: isStale(market),
    },
  };
}

// -- Write tools ---------------------------------------------------------------

/** The three conditions a key must meet before it writes anything. Re-checked
 *  here and not only at the route: the scope says what the key may do, `can()`
 *  what its owner may do, and an author record is what makes a by-line exist —
 *  the same rule /admin/perfil states. */
function writeRefusal(principal: McpPrincipal): string | null {
  if (!hasScope(principal.scopes, 'stories:write')) {
    return 'this key is read-only: it does not carry the stories:write scope. '
      + 'Mint a new key with writing enabled at /admin/mcp.';
  }
  if (!can(principal.role, 'story:own')) return 'this account may not write stories';
  if (!principal.authorId) {
    return 'this account has no public author record, so it cannot sign a story. '
      + 'Ask the newsroom to link one.';
  }
  return null;
}

const editUrl = (origin: string, id: string): string => abs(origin, `/admin/noticias/${id}`);

async function createDraft(
  args: Record<string, unknown>, locale: Locale, principal: McpPrincipal, origin: string,
): Promise<ToolOutcome> {
  const refusal = writeRefusal(principal);
  if (refusal) return { error: refusal };

  const topics = await getTopics(locale);
  const topicId = resolveTopic(String(args.topic ?? ''), topics);
  if (!topicId) return { error: `unknown topic '${String(args.topic)}'. Valid topics: ${topicHelp(topics)}` };

  // createStory() commits on its own and saveStory() opens its own transaction,
  // so a failure between them leaves a story with no text — visible in
  // /admin/noticias as "(sin título)" — and a model that retries mints another
  // one per attempt. The row is taken back before the error travels.
  const id = await createStory(principal.authorId as string, topicId);
  try {
    await saveStory({
      id,
      locale,
      title: String(args.title ?? '').trim(),
      standfirst: String(args.standfirst ?? '').trim(),
      bodyMd: str(args.body_md) ?? '',
      topicId,
      relevance: 'medium',
    });
  } catch (e) {
    await discardEmptyStory(id).catch((cleanup: Error) => {
      console.error('[mcp] could not discard the empty story', id, cleanup.message);
    });
    throw e;
  }
  await audit('mcp.draft.created', principal.userId, { tokenId: principal.tokenId, storyId: id, locale });
  return { structured: { id, status: 'draft', editUrl: editUrl(origin, id) } };
}

async function updateDraft(
  args: Record<string, unknown>, locale: Locale, principal: McpPrincipal, origin: string,
): Promise<ToolOutcome> {
  const refusal = writeRefusal(principal);
  if (refusal) return { error: refusal };

  const id = String(args.id ?? '');
  const draft = await getDraft(id);
  if (!draft) return { error: `no story with id '${id}'` };
  // An allow-list, not `=== 'published'`. Status also has 'scheduled' and
  // 'archived' in 001_content.sql; nothing sets them today, so a deny-list is
  // correct today and silently wrong the day scheduling ships — at which point a
  // write key could rewrite a story that auto-publishes with nobody reading the
  // diff. "Writing stops at draft" is the rule, so draft is what it says.
  if (draft.status !== 'draft') {
    return {
      error: `story '${id}' is ${draft.status}, and only a draft is edited from here. `
        + 'Pulling it off the site and re-editing it is a decision for the desk, at '
        + `${editUrl(origin, id)}.`,
    };
  }
  // The permission is checked against the SPECIFIC story, exactly as
  // src/pages/admin/noticias/[id].astro does it: a journalist edits their own,
  // an editor edits anyone's.
  if (draft.authorId !== principal.authorId && !can(principal.role, 'story:any')) {
    return { error: `story '${id}' is signed by somebody else and this account may not edit it` };
  }

  const topics = await getTopics(locale);
  let topicId = draft.topicId;
  const topic = str(args.topic);
  if (topic) {
    const resolved = resolveTopic(topic, topics);
    if (!resolved) return { error: `unknown topic '${topic}'. Valid topics: ${topicHelp(topics)}` };
    topicId = resolved;
  }

  // SaveInput has NO optional fields: passing `undefined` would write an empty
  // standfirst. So what the call did not carry is taken from the stored row.
  const current = draft.i18n[locale] ?? { title: '', standfirst: '', bodyMd: '' };
  await saveStory({
    id,
    locale,
    title: str(args.title)?.trim() ?? current.title,
    standfirst: str(args.standfirst)?.trim() ?? current.standfirst,
    bodyMd: str(args.body_md) ?? current.bodyMd,
    topicId,
    relevance: (str(args.relevance) as Relevance | undefined) ?? draft.relevance,
  });
  await audit('mcp.draft.updated', principal.userId, {
    tokenId: principal.tokenId, storyId: id, locale,
  });
  return { structured: { id, status: draft.status, editUrl: editUrl(origin, id) } };
}
