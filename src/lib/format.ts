// Formato del portal. Se apoya en los formateadores del runtime de i18n
// (`fmtDate` / `fmtNumber`), que ya resuelven la etiqueta Intl del idioma: aquí
// solo viven las decisiones editoriales —qué forma tiene una fecha de noticia,
// cómo se escribe una variación de mercado— y no una segunda implementación.
import { fmtDate, fmtNumber, type Locale } from './i18n';

export const formatDate = (locale: Locale, iso: string): string =>
  fmtDate(locale, iso, { day: 'numeric', month: 'long', year: 'numeric' });

export const formatTime = (locale: Locale, iso: string): string =>
  fmtDate(locale, iso, { hour: '2-digit', minute: '2-digit' });

/** Cotización con los decimales con los que cotiza cada instrumento: el
 *  euro-dólar sin sus cuatro decimales no es un precio, es un redondeo. El
 *  separador de miles lo pone Intl, así que el mismo número sale «11.240,3» en
 *  español y «11,240.3» en inglés sin guardar dos cadenas. */
export const formatQuote = (locale: Locale, value: number, decimals: number): string =>
  fmtNumber(locale, value, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** Porcentaje con signo SIEMPRE: en un dato de mercado el signo es la mitad
 *  del dato, y sin él la única pista sería el color. */
export const formatPct = (locale: Locale, pct: number): string =>
  fmtNumber(locale, pct / 100, {
    style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always',
  });

export type Direction = 'up' | 'down' | 'flat';
export const directionOf = (pct: number): Direction => (pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat');

/** La flecha viaja en el texto, no en CSS: quien no ve el color tiene que
 *  poder oír «sube». */
export const ARROW: Record<Direction, string> = { up: '▲', down: '▼', flat: '–' };
