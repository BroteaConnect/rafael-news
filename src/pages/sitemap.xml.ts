import type { APIRoute } from 'astro';
import { getArticles, getTopics } from '../lib/content/store';
import { LOCALES, localePath } from '../lib/i18n';

// Sitemap con alternativas hreflang. Se genera desde la instantánea, así que
// una noticia nueva entra en el sitemap en el mismo instante en que entra en
// la portada — sin tarea programada que se olvide de correr.
export const prerender = false;

export const GET: APIRoute = async ({ site }) => {
  const origin = site?.origin ?? 'https://rafael-news.brotea.dev';
  const abs = (path: string) => new URL(path, origin).href;

  const paths = ['/', '/noticias', '/temas', '/legal'];
  for (const topic of await getTopics(LOCALES[0]!)) paths.push(`/tema/${topic.slug}`);
  for (const story of await getArticles(LOCALES[0]!)) paths.push(`/noticia/${story.slug}`);
  paths.push('/autor/rafael-ojeda');

  // Cada URL declara a sus hermanas en los demás idiomas: sin esto, un buscador
  // trata la versión inglesa como contenido duplicado en vez de traducción.
  const urls = paths.flatMap((path) =>
    LOCALES.map((locale) => `  <url>
    <loc>${abs(localePath(locale, path))}</loc>
${LOCALES.map((alt) => `    <xhtml:link rel="alternate" hreflang="${alt}" href="${abs(localePath(alt, path))}" />`).join('\n')}
  </url>`),
  ).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
