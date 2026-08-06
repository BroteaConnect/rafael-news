import type { APIRoute } from 'astro';
import { getArticles } from '../lib/content/store';
import { DEFAULT_LOCALE, localePath } from '../lib/i18n';

// El RSS de un medio no es nostalgia: es como lo leen los agregadores, los
// lectores que no quieren otra newsletter y quien nos quiera citar.
//
// Sale de la instantánea, así que no cuesta ni una consulta, y se cachea como
// el HTML: al publicar, el ETag del middleware cambia y el agregador se entera.
export const prerender = false;

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export const GET: APIRoute = async ({ site }) => {
  const locale = DEFAULT_LOCALE;
  const stories = await getArticles(locale);
  const origin = site?.origin ?? 'https://rafael-news.brotea.dev';
  const abs = (path: string) => new URL(path, origin).href;

  const items = stories.map((s) => `    <item>
      <title>${escape(s.title)}</title>
      <link>${abs(localePath(locale, `/noticia/${s.slug}`))}</link>
      <guid isPermaLink="true">${abs(localePath(locale, `/noticia/${s.slug}`))}</guid>
      <description>${escape(s.standfirst)}</description>
      <category>${escape(s.topicName)}</category>
      <dc:creator>${escape(s.author.name)}</dc:creator>
      <pubDate>${new Date(s.publishedAt).toUTCString()}</pubDate>
    </item>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Brotea News</title>
    <link>${origin}</link>
    <atom:link href="${abs('/rss.xml')}" rel="self" type="application/rss+xml" />
    <description>Las noticias financieras que de verdad importan, explicadas para que las entiendas.</description>
    <language>es-ES</language>
${items}
  </channel>
</rss>
`;

  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
