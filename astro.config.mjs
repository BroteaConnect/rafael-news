import { defineConfig } from 'astro/config';

// Static output: deployable to Cloudflare Pages or any static host.
export default defineConfig({
  // absolute hreflang alternates need the canonical origin
  site: 'https://rafael-news.brotea.dev',
  output: 'static',
});
