// La ÚNICA puerta de lectura del contenido. Las páginas llaman a estos
// accesores y jamás a los datos: en F2 el cuerpo de cada función pasa a ser una
// consulta a Postgres y ni un componente cambia.
//
// Los accesores son `async` HOY, con una semilla en memoria que no lo necesita,
// justo por eso: un accesor síncrono sería una promesa que F2 no podría
// mantener sin reescribir todas las páginas que lo llaman.
//
// Los datos viven en seed.data.json y no aquí dentro para que el test de
// contenido (src/locales/content.test.mjs) pueda leerlos con node pelado: los
// tests corren sin Vite, así que un .ts con `import.meta.glob` detrás no se
// puede importar desde node --test.
import raw from './seed.data.json';
import { DEFAULT_LOCALE, type Locale } from '../i18n';
import type {
  Author, AuthorView, ContentSource, Localized, MarketSnapshot,
  Story, StoryView, TopicId, TopicView,
} from './types';

// Único punto donde el JSON se convierte en el modelo: TypeScript infiere
// `string` para las uniones (`topicId`, `relevance`) al importar un .json, y
// validarlo campo a campo aquí sería reimplementar el esquema que F2 va a
// borrar. El test de contenido es quien comprueba que el fichero cumple.
const SOURCE = raw as unknown as ContentSource;

/** Elige el idioma de un texto editorial; sin traducción, cae al idioma por
 *  defecto antes que a un hueco en blanco. */
export const localize = (value: Localized, locale: Locale): string =>
  value[locale] ?? value[DEFAULT_LOCALE] ?? '';

const newestFirst = (a: Story, b: Story) => b.publishedAt.localeCompare(a.publishedAt);

// Iniciales para el avatar tipográfico: el portal todavía no tiene fotos y una
// imagen inventada envejece peor que dos letras bien puestas.
const initialsOf = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word.charAt(0)).join('').toUpperCase();

const authorView = (author: Author, locale: Locale): AuthorView => ({
  id: author.id,
  slug: author.slug,
  name: author.name,
  role: localize(author.role, locale),
  bio: localize(author.bio, locale),
  initials: initialsOf(author.name),
});

const authorOf = (id: string): Author => {
  const author = SOURCE.authors.find((a) => a.id === id) ?? SOURCE.authors[0];
  if (!author) throw new Error('el portal no tiene ni un autor: la home no puede firmar nada');
  return author;
};

const topicOf = (id: TopicId) => SOURCE.topics.find((t) => t.id === id);

const storyView = (story: Story, locale: Locale): StoryView => {
  // Un tema que falte no puede tumbar la portada: se cae al id, que es feo
  // pero legible, en vez de reventar el render de todas las noticias.
  const topic = topicOf(story.topicId);
  return {
    id: story.id,
    slug: story.slug,
    topicId: story.topicId,
    topicName: topic ? localize(topic.name, locale) : story.topicId,
    topicSlug: topic?.slug ?? story.topicId,
    relevance: story.relevance,
    publishedAt: story.publishedAt,
    readingMinutes: story.readingMinutes,
    title: localize(story.title, locale),
    standfirst: localize(story.standfirst, locale),
    author: authorView(authorOf(story.authorId), locale),
  };
};

/** El autor del portal. Es de un solo firmante por diseño. */
export async function getAuthor(locale: Locale): Promise<AuthorView> {
  const author = SOURCE.authors[0];
  if (!author) throw new Error('el portal no tiene ni un autor');
  return authorView(author, locale);
}

/** El destacado del día. Nunca devuelve undefined: sin portada no hay home. */
export async function getLeadStory(locale: Locale): Promise<StoryView> {
  const lead = SOURCE.stories.find((s) => s.lead) ?? [...SOURCE.stories].sort(newestFirst)[0];
  if (!lead) throw new Error('no hay ni una noticia publicada: la home no puede renderizar');
  return storyView(lead, locale);
}

/** Todas las noticias, de la más reciente a la más antigua. */
export async function getArticles(locale: Locale): Promise<StoryView[]> {
  return [...SOURCE.stories].sort(newestFirst).map((s) => storyView(s, locale));
}

/** Los temas con cuántas noticias publicadas tiene cada uno. */
export async function getTopics(locale: Locale): Promise<TopicView[]> {
  return SOURCE.topics.map((topic) => ({
    id: topic.id,
    slug: topic.slug,
    name: localize(topic.name, locale),
    count: SOURCE.stories.filter((s) => s.topicId === topic.id).length,
  }));
}

/** Una noticia por su slug, o null si no existe (la página devuelve 404). */
export async function getStory(slug: string, locale: Locale): Promise<StoryView | null> {
  const story = SOURCE.stories.find((s) => s.slug === slug);
  return story ? storyView(story, locale) : null;
}

/** El tema al que apunta un slug de URL. Ojo: el slug ESTÁ traducido
 *  (`mercados`, no `markets`), así que no vale buscar por id. */
export async function getTopic(slug: string, locale: Locale): Promise<TopicView | null> {
  const topic = SOURCE.topics.find((t) => t.slug === slug);
  if (!topic) return null;
  return {
    id: topic.id,
    slug: topic.slug,
    name: localize(topic.name, locale),
    count: SOURCE.stories.filter((s) => s.topicId === topic.id).length,
  };
}

export async function getStoriesByTopic(id: TopicId, locale: Locale): Promise<StoryView[]> {
  return [...SOURCE.stories].filter((s) => s.topicId === id).sort(newestFirst)
    .map((s) => storyView(s, locale));
}

export async function getAuthorBySlug(slug: string, locale: Locale): Promise<AuthorView | null> {
  const author = SOURCE.authors.find((a) => a.slug === slug);
  return author ? authorView(author, locale) : null;
}

export async function getStoriesByAuthor(authorId: string, locale: Locale): Promise<StoryView[]> {
  return [...SOURCE.stories].filter((s) => s.authorId === authorId).sort(newestFirst)
    .map((s) => storyView(s, locale));
}

/** Índice del buscador de la cabecera. Diminuto a propósito: con 3-5 noticias
 *  al día cabe entero en una respuesta y el filtrado ocurre en el cliente, sin
 *  ningún servicio de búsqueda que mantener ni que caerse. */
export async function getSearchIndex(locale: Locale) {
  return (await getArticles(locale)).map((s) => ({
    slug: s.slug,
    title: s.title,
    standfirst: s.standfirst,
    topic: s.topicName,
  }));
}

/** La instantánea de mercado. Sin idioma a propósito: los nombres vienen
 *  traducidos dentro y quien pinta decide cuál usa. F3 sustituye el cuerpo por
 *  un sondeo en servidor contra el proveedor — nunca desde el navegador, que
 *  filtraría la clave y gastaría cuota por visita. */
export async function getMarket(): Promise<MarketSnapshot> {
  return SOURCE.market;
}

/** Margen sobre el retardo declarado a partir del cual el dato deja de
 *  presentarse como fresco. */
export const STALE_AFTER_MINUTES = 20;

export function isStale(snapshot: MarketSnapshot, now = new Date()): boolean {
  const ageMinutes = (now.getTime() - new Date(snapshot.asOf).getTime()) / 60000;
  return ageMinutes > snapshot.delayMinutes + STALE_AFTER_MINUTES;
}
