// El CONTRATO de contenido del portal. Estos tipos son lo único que F2 promete
// no cambiar: cuando la semilla se sustituya por consultas a Postgres, las
// páginas no se tocan porque solo conocen estas formas y los accesores de
// seed.ts.
//
// Por qué los textos editoriales son `Localized` y no claves de i18n: un
// titular no es copia de interfaz, es una fila. En F2 vive en una tabla
// multilingüe, no en src/locales/*.json, así que el modelo ya se parece hoy a
// lo que será entonces. La copia de interfaz (secciones, botones, avisos) sí
// va en los diccionarios y llega por t().
import type { Locale } from '../i18n';

/** Un mismo texto en cada idioma publicado. */
export type Localized = Record<Locale, string>;

export type TopicId = 'macro' | 'markets' | 'crypto' | 'fx';

/** Cuánto pesa la noticia en la portada del día. */
export type Relevance = 'high' | 'medium' | 'low';

// -- Entidades (la forma que tendrán las filas) --------------------------------

export interface Author {
  id: string;
  slug: string;
  /** un nombre propio no se traduce */
  name: string;
  role: Localized;
  bio: Localized;
}

export interface Topic {
  id: TopicId;
  slug: string;
  name: Localized;
}

export interface Story {
  id: string;
  slug: string;
  topicId: TopicId;
  authorId: string;
  relevance: Relevance;
  /** ISO 8601 en UTC: la zona y el formato los pone Intl al presentar */
  publishedAt: string;
  readingMinutes: number;
  title: Localized;
  standfirst: Localized;
  /** el destacado del día; exactamente uno */
  lead: boolean;
}

export interface Quote {
  id: string;
  /** «Oro» no es «Gold»: el nombre del instrumento también es contenido */
  name: Localized;
  value: number;
  /** decimales con los que cotiza el instrumento (el euro-dólar usa 4) */
  decimals: number;
  changePct: number;
}

export interface MarketSnapshot {
  quotes: readonly Quote[];
  /** ISO 8601 UTC del DATO, no de la petición */
  asOf: string;
  /** retardo declarado por el proveedor, en minutos */
  delayMinutes: number;
  /** Cifras de muestra, no de un proveedor real. Se DICE en la barra: una
   *  instantánea fija envejece al minuto, y presentarla como cotización en
   *  directo con 15 minutos de retardo sería mentir sobre el dato. F3 pone
   *  esto a false el día que enchufa el proveedor. */
  sample: boolean;
}

/** Lo que carga seed.ts: en F2 será el resultado de las consultas. */
export interface ContentSource {
  authors: readonly Author[];
  topics: readonly Topic[];
  stories: readonly Story[];
  market: MarketSnapshot;
}

// -- Vistas (una entidad ya resuelta para un idioma) ---------------------------
// Las páginas reciben strings, nunca `Localized`: así ningún componente tiene
// que saber cómo se elige idioma ni qué pasa si falta una traducción.

export interface AuthorView {
  id: string;
  slug: string;
  name: string;
  role: string;
  bio: string;
  /** iniciales para el avatar tipográfico */
  initials: string;
}

export interface TopicView {
  id: TopicId;
  slug: string;
  name: string;
  /** noticias publicadas en el tema */
  count: number;
}

export interface StoryView {
  id: string;
  slug: string;
  topicId: TopicId;
  topicName: string;
  /** el slug ESTÁ traducido (`mercados`, no `markets`): quien enlaza no debe
   *  tener que mapear ids a slugs a mano */
  topicSlug: string;
  relevance: Relevance;
  publishedAt: string;
  readingMinutes: number;
  title: string;
  standfirst: string;
  author: AuthorView;
}
