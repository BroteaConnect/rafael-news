// content.test.mjs — el mismo gate que locales.test.mjs, para el CONTENIDO.
// `npm test` corre `node --test src/locales/*.test.mjs`, así que este fichero
// entra solo por vivir aquí, y el asunto que comprueba es exactamente el mismo:
// que la portada esté completa en todos los idiomas obligatorios.
//
// Dos mitades:
//   1. la semilla editorial (src/lib/content/seed.data.json), que en F2 pasa a
//      ser filas de Postgres: ids únicos, referencias que existen y ni un texto
//      vacío en ningún idioma requerido.
//   2. las claves de interfaz que los componentes piden con t(): si una falta en
//      un diccionario, t() cae al idioma por defecto y la página se sirve a
//      medio traducir con CI en verde. Aquí se cae antes.
//
// Se lee el JSON con fs y no se importa el .ts: estos tests corren en node
// pelado, sin Vite, y el módulo de contenido acabaría arrastrando
// `import.meta.glob`. Por eso los datos viven en un .json aparte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const SRC = join(DIR, '..');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));

const config = read(join(DIR, 'config.json'));
const seed = read(join(SRC, 'lib/content/seed.data.json'));
const dicts = Object.fromEntries(
  config.locales.map((code) => [code, read(join(DIR, `${code}.json`))]),
);

/** Todos los textos multilingües de un objeto, como [ruta, valor-por-idioma]. */
const localizedFields = (item, path, out = []) => {
  for (const [key, value] of Object.entries(item)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const isLocalized = config.locales.some((code) => typeof value[code] === 'string');
      if (isLocalized) out.push([`${path}.${key}`, value]);
      else localizedFields(value, `${path}.${key}`, out);
    }
  }
  return out;
};

const allItems = () => [
  ...seed.authors.map((a) => [`authors[${a.id}]`, a]),
  ...seed.topics.map((t) => [`topics[${t.id}]`, t]),
  ...seed.stories.map((s) => [`stories[${s.id}]`, s]),
  ...seed.market.quotes.map((q) => [`market.quotes[${q.id}]`, q]),
];

test('cada texto de la semilla está en todos los idiomas obligatorios', () => {
  for (const [path, item] of allItems()) {
    const fields = localizedFields(item, path);
    assert.ok(fields.length > 0, `${path} no tiene ni un texto multilingüe`);
    for (const [field, value] of fields) {
      for (const code of config.required) {
        assert.equal(typeof value[code], 'string', `${field} no tiene versión '${code}'`);
        assert.notEqual(value[code].trim(), '', `${field} está vacío en '${code}'`);
      }
      const extra = Object.keys(value).filter((code) => !config.locales.includes(code));
      assert.deepEqual(extra, [], `${field} trae idiomas no declarados: ${extra.join(', ')}`);
    }
  }
});

test('los identificadores son únicos', () => {
  for (const [name, rows] of Object.entries({
    authors: seed.authors, topics: seed.topics, stories: seed.stories, quotes: seed.market.quotes,
  })) {
    const ids = rows.map((r) => r.id);
    assert.deepEqual([...new Set(ids)].sort(), [...ids].sort(), `${name}: hay ids repetidos`);
  }
  const slugs = seed.stories.map((s) => s.slug);
  assert.deepEqual([...new Set(slugs)].sort(), [...slugs].sort(), 'hay slugs de noticia repetidos');
});

test('las noticias apuntan a un tema y a un autor que existen', () => {
  const topics = new Set(seed.topics.map((t) => t.id));
  const authors = new Set(seed.authors.map((a) => a.id));
  for (const story of seed.stories) {
    assert.ok(topics.has(story.topicId), `${story.id}: tema inexistente '${story.topicId}'`);
    assert.ok(authors.has(story.authorId), `${story.id}: autor inexistente '${story.authorId}'`);
  }
});

test('hay exactamente una noticia destacada y todas tienen fecha válida', () => {
  const leads = seed.stories.filter((s) => s.lead);
  assert.equal(leads.length, 1, 'la portada necesita una y solo una noticia destacada');
  for (const story of seed.stories) {
    assert.ok(!Number.isNaN(Date.parse(story.publishedAt)), `${story.id}: fecha ilegible`);
    assert.ok(story.readingMinutes > 0, `${story.id}: minutos de lectura sin sentido`);
    assert.ok(['high', 'medium', 'low'].includes(story.relevance), `${story.id}: relevancia inválida`);
  }
});

// -- Claves de interfaz -------------------------------------------------------
// Se rastrea el código de verdad en lugar de mantener una lista a mano: una
// lista se queda vieja el día que alguien añade una sección.
const sourceFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = join(dir, entry.name);
  if (entry.isDirectory()) return sourceFiles(full);
  return /\.(astro|ts)$/.test(entry.name) && !entry.name.endsWith('.test.mjs') ? [full] : [];
});

// Las claves que se arman con una plantilla (`relevance.${...}`) no se pueden
// leer del código: se declara aquí qué valores puede tomar cada familia, que es
// justo la lista que rompería la página si alguien añadiera un valor nuevo.
const DYNAMIC = {
  'relevance.': ['high', 'medium', 'low'],
  'a11y.market.': ['up', 'down', 'flat'],
};

test('toda clave que piden los componentes existe en los dos diccionarios', () => {
  const used = new Set();
  for (const file of sourceFiles(SRC)) {
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(/\bt\(\s*locale\s*,\s*'([^'${}]+)'/g)) used.add(m[1]);
    for (const m of code.matchAll(/\bt\(\s*locale\s*,\s*`([a-z0-9._-]+\.)\$\{/gi)) {
      const values = DYNAMIC[m[1]];
      assert.ok(values, `familia de claves dinámica sin declarar en el test: '${m[1]}'`);
      for (const value of values) used.add(`${m[1]}${value}`);
    }
  }
  assert.ok(used.size > 10, 'no se ha encontrado casi ninguna clave: el rastreo está roto');

  const PLURAL_SUFFIXES = ['one', 'other', 'few', 'many', 'zero', 'two'];
  for (const code of config.required) {
    const dict = dicts[code];
    const missing = [...used].filter((key) => {
      if (dict[key] !== undefined) return false;
      // Una clave con plural vive partida en `.one` / `.other`.
      return !PLURAL_SUFFIXES.some((suffix) => dict[`${key}.${suffix}`] !== undefined);
    });
    assert.deepEqual(missing, [], `${code}.json no tiene: ${missing.join(', ')}`);
  }
});

test('los diccionarios no cargan con claves que ya no usa nadie', () => {
  const used = new Set();
  for (const file of sourceFiles(SRC)) {
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(/'([a-z0-9][a-z0-9._-]*\.[a-z0-9._-]+)'/gi)) used.add(m[1]);
    for (const m of code.matchAll(/`([a-z0-9._-]+\.)\$\{/gi)) {
      for (const value of DYNAMIC[m[1]] ?? []) used.add(`${m[1]}${value}`);
    }
  }
  const orphans = Object.keys(dicts[config.defaultLocale])
    .map((key) => key.replace(/\.(zero|one|two|few|many|other)$/, ''))
    .filter((key) => !used.has(key));
  assert.deepEqual([...new Set(orphans)], [],
    `sobran claves en los diccionarios: ${[...new Set(orphans)].join(', ')}`);
});
