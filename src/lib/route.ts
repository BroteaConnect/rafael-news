// Resolución de idioma para páginas renderizadas en servidor.
//
// Con salida estática cada página declaraba `getStaticPaths = localePaths` y
// Astro le pasaba el idioma como prop. En servidor no hay tal cosa: el idioma
// sale de la URL, y con él la obligación de RECHAZAR lo que no es un idioma.
// Sin esta comprobación, `/xx/` renderizaría la portada en español bajo una URL
// inventada — contenido duplicado servido con un 200, que es justo lo que un
// buscador castiga.
import { DEFAULT_LOCALE, isLocale, type Locale } from './i18n';

/** El idioma del prefijo, o null si el prefijo no es un idioma publicado. */
export function resolveLocale(lang: string | undefined): Locale | null {
  if (!lang) return DEFAULT_LOCALE;
  // `[...lang]` es un parámetro de resto: `/a/b` llega entero como 'a/b' y no
  // es un idioma, así que cae igual que `/xx`.
  if (isLocale(lang) && lang !== DEFAULT_LOCALE) return lang;
  return null;
}
