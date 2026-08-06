# Architecture

Brotea News is an Astro app with `output: 'server'` (node adapter, standalone):
**every route is rendered per request**, no page opts into prerendering. Content
comes from a typed seed behind async accessors; the pages never see where it is
stored. Runtime and packaging live in [deployment.md](./deployment.md).

## Routes

Spanish is the default locale and is unprefixed; English lives under `/en/`.
The path segments are Spanish in both languages (`/en/noticia/...`), and so are
topic slugs (`macro`, `mercados`, `cripto`, `divisas`) — one slug per topic, not
one per language.

| Spanish | English | File | Renders |
| --- | --- | --- | --- |
| `/` | `/en/` | `src/pages/[...lang]/index.astro` | home: hero, cards, newsletter, author, topics |
| `/noticias` | `/en/noticias` | `[...lang]/noticias.astro` | every story, newest first |
| `/temas` | `/en/temas` | `[...lang]/temas.astro` | topic tiles with counts |
| `/noticia/<slug>` | `/en/noticia/<slug>` | `[...lang]/noticia/[slug].astro` | story page + `NewsArticle` JSON-LD + related |
| `/tema/<slug>` | `/en/tema/<slug>` | `[...lang]/tema/[slug].astro` | stories of one topic |
| `/autor/<slug>` | `/en/autor/<slug>` | `[...lang]/autor/[slug].astro` | author page + their stories |
| `/legal` | `/en/legal` | `[...lang]/legal.astro` | notice / `#privacidad` / `#cookies` |
| `/search-index.json` | `/en/search-index.json` | `[...lang]/search-index.json.ts` | `GET` search index (JSON) |
| `/404` | `/404` | `404.astro` | 404 page, always in the default locale |

Locale-agnostic endpoints (no language prefix):

| Route | File | Behaviour |
| --- | --- | --- |
| `GET /healthz` | `src/pages/healthz.ts` | `200 {"ok":true,"commit":"<sha or null>"}`, `Cache-Control: no-store` |
| `POST /api/newsletter` | `src/pages/api/newsletter.ts` | `202` accepted, `400` invalid email, `502` upstream failed |

Language resolution in every page is `resolveLocale(Astro.params.lang)` from
`src/lib/route.ts`: no prefix → default locale, a published locale → that
locale, anything else → `null`, and the page answers `Astro.rewrite('/404')`.
A missing story/topic/author does the same. `/xx/` therefore 404s instead of
serving the Spanish home under an invented URL.

Legacy `/es*` URLs are 301-redirected in `astro.config.mjs`
(`'/es' → '/'`, `'/es/[...rest]' → '/[...rest]'`).

```bash
curl -s localhost:4321/healthz
# {"ok":true,"commit":"…"}

curl -s localhost:4321/en/search-index.json
# [{"slug":"bce-tipos-septiembre","title":"…","standfirst":"…","topic":"Macro"}, …]

curl -i -X POST localhost:4321/api/newsletter \
  -H 'Content-Type: application/json' \
  -d '{"email":"lector@example.com","locale":"es"}'
# HTTP/1.1 202 Accepted → {"message":"<translated>"}
```

The search index is one response per locale (`Cache-Control: public,
s-maxage=60, stale-while-revalidate=86400`); filtering happens in the browser
inside `Search.astro`, which fetches it the first time the dialog opens.

## Content contract

Two files, and they are the boundary F2 (database-backed content) works against.

`src/lib/content/types.ts` — types only:

- `Localized = Record<Locale, string>` — the same text in every published language.
- Entities, shaped like the future rows: `Author` (`id`, `slug`, `name`,
  `role`, `bio`), `Topic` (`id: TopicId`, `slug`, `name`), `Story` (`id`,
  `slug`, `topicId`, `authorId`, `relevance`, `publishedAt` ISO-8601 UTC,
  `readingMinutes`, `title`, `standfirst`, `lead`), `Quote` (`id`, `name`,
  `value`, `decimals`, `changePct`), `MarketSnapshot` (`quotes`, `asOf`,
  `delayMinutes`, `sample`) and `ContentSource` grouping all of them.
- Views, one entity already resolved for one language: `AuthorView`,
  `TopicView` (adds `count`), `StoryView` (adds `topicName`, `topicSlug` and a
  nested `AuthorView`). **Views carry plain strings, never `Localized`** — no
  component has to know how a language is picked.

`src/lib/content/seed.ts` — the only read gate. Every accessor is `async`:

| Accessor | Returns |
| --- | --- |
| `getLeadStory(locale)` | `StoryView` — the flagged lead, else the newest; throws if there is none |
| `getArticles(locale)` | `StoryView[]`, newest first |
| `getStory(slug, locale)` | `StoryView \| null` |
| `getStoriesByTopic(topicId, locale)` | `StoryView[]` |
| `getTopics(locale)` | `TopicView[]` with published counts |
| `getTopic(slug, locale)` | `TopicView \| null` — looked up by **slug**, not id |
| `getAuthor(locale)` | `AuthorView` — the portal's single by-line |
| `getAuthorBySlug(slug, locale)` | `AuthorView \| null` |
| `getStoriesByAuthor(authorId, locale)` | `StoryView[]` |
| `getSearchIndex(locale)` | `{ slug, title, standfirst, topic }[]` |
| `getMarket()` | `MarketSnapshot` — no locale: quote names arrive `Localized` |

Helpers exported alongside them: `localize(value, locale)` (falls back to the
default locale, never to a blank), `isStale(snapshot, now?)` and
`STALE_AFTER_MINUTES = 20`.

Rules that make the F2 swap a no-op for the pages:

- **The accessors are the contract.** F2 replaces their bodies with Postgres
  queries; signatures and view shapes do not change, so no page changes.
- They are `async` today on purpose, with an in-memory seed that does not need
  it — a synchronous accessor would be a promise F2 could not keep.
- **Pages must never import the raw data.** The seed lives in
  `src/lib/content/seed.data.json` (plain JSON so the node test can read it
  without Vite); only `seed.ts` imports it, and that file disappears in F2.

## Copy vs content

Two different things, and they live in two different places.

- **UI chrome** — nav labels, section headings, buttons, form messages, footer,
  `aria-label`s: `src/locales/es.json` and `src/locales/en.json`, reaching the
  markup only through `t(locale, 'key')`. Never hardcoded in a component.
- **Editorial content** — headlines, standfirsts, topic names, the author bio,
  market instrument names: `Localized` fields inside the content model. A
  headline is a row, not interface copy: in F2 it lives in a multilingual table,
  not in a locale file, so the model already looks today like what it will be.

`src/locales/content.test.mjs` enforces both halves:

1. every localized field in the seed exists and is non-empty in each `required`
   locale, and carries no undeclared language;
2. ids are unique (authors, topics, stories, quotes) and story slugs are unique;
3. every story points at a topic and an author that exist;
4. exactly one story is flagged `lead`, dates parse, `readingMinutes > 0`,
   `relevance` is one of `high|medium|low`;
5. every `t()` key the source actually uses exists in **both** dictionaries, and
   no dictionary key is orphaned. Keys built from a template (`relevance.${…}`,
   `a11y.market.${…}`) are declared in the test's `DYNAMIC` map — adding a new
   dynamic family means adding it there.

Without (5) a missing key silently falls back to Spanish and the page ships half
translated with green CI.

## Components

All under `src/components/`, one per page section, every one imported (an orphan
component counts as a dead file against the fleet budget).

| Component | Renders | Takes |
| --- | --- | --- |
| `SiteHeader.astro` | sticky header: wordmark, 4 nav links, search, subscribe CTA, market bar | `locale` |
| `MarketBar.astro` | quote strip with arrow, signed %, and the sample/stale/delay notice | `locale` (data from `getMarket()`) |
| `Search.astro` | header search dialog; fetches the locale's search index on first open | `locale` |
| `Hero.astro` | lead story: topic tag, headline, standfirst, by-line | `locale`, `story: StoryView` |
| `ArticleCard.astro` | one story card with a single stretched link | `locale`, `story: StoryView` |
| `StoryGrid.astro` | responsive grid of `ArticleCard` | `locale`, `stories: StoryView[]` |
| `NewsletterStrip.astro` | inverted band with the `POST /api/newsletter` form and its status line | `locale` |
| `AuthorBlock.astro` | home author panel: initials avatar, role, bio, story count | `locale`, `author: AuthorView`, `stories: number` |
| `TopicList.astro` | topic tiles with icon, name and count | `locale`, `topics: TopicView[]` |
| `SiteFooter.astro` | legal links, language switcher, disclaimer, copyright, "powered by brotea" | `locale` |
| `LanguageSwitcher.astro` | locale links (**generated file**, do not edit) | `locale` |

`src/layouts/Layout.astro` wraps them: `<html lang dir>`, title/description,
canonical, Open Graph, hreflang alternates + `x-default`, the display-font
preload, analytics and error-tracking snippets, header, `<main>`, footer.

## Theme and formatting rules

- **No hex literals, no hardcoded spacing** in components. Colors, radii, shadow,
  spacing, `--container` and `--measure` come from the `brotea-news` theme
  (`src/styles/theme.css`); shared classes (`.container`, `.measure`, `.section`,
  `.section-title`, `.btn`, `.tag`, `.byline`, `.visually-hidden`) live in
  `src/styles/base.css`.
- Market up/down **text** uses `--ok-strong` / `--danger-strong`. `--ok` and
  `--danger` pass AA as decoration, not as text.
- An inverted band gets the `.invert` class, which re-binds the whole token
  vocabulary (including light/dark), instead of hand-picked colors. See
  `NewsletterStrip.astro`.
- Numbers and dates go through `src/lib/format.ts`, which wraps the i18n
  runtime's `fmtNumber` / `fmtDate`: `formatDate`, `formatTime`, `formatQuote`
  (per-instrument decimals), `formatPct` (`signDisplay: 'always'`),
  `directionOf` and `ARROW`. Never hand-roll a separator or a date string.
- Direction is never color-only: the market bar ships an arrow, a signed
  percentage and a visually hidden `a11y.market.<up|down|flat>` label.
- Astro traps this app already hit: a scoped `<style>` never matches nodes built
  with `createElement` (`Search.astro` uses `:global()` for its results), and
  `[hidden]` loses to any author `display` rule.

**Generated files — never edit them in this repo.** Fix them in the factory and
re-sync; the next sync overwrites local changes:

```
src/lib/i18n.ts
src/locales/locales.test.mjs
src/components/LanguageSwitcher.astro
src/styles/theme.css
.github/workflows/ci.yml
scripts/build-stamp.mjs
```

`src/locales/config.json` and `brotea.json` are app **data** and may be edited —
consistently and together (both carry `defaultLocale` and the locale list).

## Testing

```bash
npm test
# node scripts/build-stamp.mjs && node --test src/locales/*.test.mjs && astro check && astro build
```

So the suite is: the locale/content tests, the TypeScript check, and a real
build. The `test` script is owned by the quality capability — do not edit it,
the next `brotea quality sync` would overwrite it.

**A new test must live at `src/locales/*.test.mjs`** or nothing runs it. Those
files execute in bare node (`node --test`), without Vite: read fixtures with
`fs`, never `import` a `.ts` module that pulls in `import.meta.glob`. That is
why the seed data sits in `seed.data.json` next to the module that consumes it.

Green `npm test` proves nothing about the runtime — the image is built, run and
curled by the docker CI job (see [deployment.md](./deployment.md)).
