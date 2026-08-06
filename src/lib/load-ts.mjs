// load-ts.mjs — lets `node --test` import this app's .ts modules without a
// build step. The node runtime here may ship without TypeScript support
// (ERR_NO_TYPESCRIPT), so types are stripped with esbuild — already present
// in node_modules as astro's own dependency — and the result is imported as
// a data: URL. This only works for self-contained modules (no relative
// imports), which is exactly the constraint that keeps templates.ts and
// docstore.ts node-testable.
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

export function loadTs(url) {
  const { code } = transformSync(readFileSync(url, 'utf8'), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`);
}
