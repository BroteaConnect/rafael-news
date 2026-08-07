// El renderizador de markdown es la única puerta por la que entra HTML al
// portal. Si falla, no da un error visible: da un agujero. Por eso la mitad de
// este fichero son intentos de inyección, no ejemplos bonitos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from '../lib/load-ts.mjs';

const { renderMarkdown, readingMinutes, slugify } =
  await loadTs(new URL('../lib/markdown.ts', import.meta.url));

// -- Lo que tiene que salir bien ---------------------------------------------
test('párrafos, encabezados y marcas de línea', () => {
  assert.equal(renderMarkdown('Hola mundo'), '<p>Hola mundo</p>');
  assert.equal(renderMarkdown('## Un titular'), '<h2>Un titular</h2>');
  assert.equal(renderMarkdown('**fuerte**'), '<p><strong>fuerte</strong></p>');
  assert.equal(renderMarkdown('*suave*'), '<p><em>suave</em></p>');
});

test('los encabezados empiezan en h2: el h1 es el titular de la página', () => {
  // Un `#` suelto no produce h1; queda como párrafo.
  assert.equal(renderMarkdown('# No soy un h1'), '<p># No soy un h1</p>');
  assert.match(renderMarkdown('#### Cuarto nivel'), /^<h4>/);
});

test('listas, citas y código', () => {
  assert.equal(renderMarkdown('- uno\n- dos'), '<ul><li>uno</li><li>dos</li></ul>');
  assert.equal(renderMarkdown('1. uno\n2. dos'), '<ol><li>uno</li><li>dos</li></ol>');
  assert.equal(renderMarkdown('> citado'), '<blockquote><p>citado</p></blockquote>');
  assert.equal(renderMarkdown('usa `npm test`'), '<p>usa <code>npm test</code></p>');
});

test('el marcador interno de código no choca con texto real', () => {
  // Un marcador «legible» tipo ` 0 ` rompería esta frase.
  assert.equal(renderMarkdown('el 0 es el suelo'), '<p>el 0 es el suelo</p>');
  assert.equal(renderMarkdown('el 0 es `codigo` y 1 no'), '<p>el 0 es <code>codigo</code> y 1 no</p>');
});

test('un párrafo se corta con una línea en blanco, no antes', () => {
  assert.equal(renderMarkdown('una\ndos\n\ntres'), '<p>una dos</p>\n<p>tres</p>');
});

// -- Lo que NO puede salir ----------------------------------------------------
test('el HTML del autor se escapa: no se ejecuta nada', () => {
  const html = renderMarkdown('<script>alert(1)</script>');
  assert.ok(!html.includes('<script'), 'no puede aparecer una etiqueta script');
  assert.ok(html.includes('&lt;script&gt;'), 'tiene que verse como texto');
});

test('atributos con manejadores tampoco pasan', () => {
  const html = renderMarkdown('<img src=x onerror="alert(1)">');
  assert.ok(!html.includes('<img'), 'ninguna etiqueta del autor sobrevive');
  assert.ok(html.includes('&lt;img'), 'queda escapado como texto');
  // Y las comillas del manejador también, para que no puedan cerrar un
  // atributo de una etiqueta nuestra.
  assert.ok(!html.includes('onerror="'), 'ni un atributo con comillas vivas');
});

test('javascript: en un enlace se descarta y queda solo el texto', () => {
  const html = renderMarkdown('[pincha](javascript:alert(1))');
  assert.ok(!html.includes('href'), `no debería haber href: ${html}`);
  assert.ok(html.includes('pincha'));
});

test('los trucos para esquivar el filtro de esquema tampoco cuelan', () => {
  for (const url of ['JaVaScRiPt:alert(1)', 'java script:alert(1)', 'data:text/html;base64,x', 'vbscript:msgbox']) {
    const html = renderMarkdown(`[x](${url})`);
    assert.ok(!html.includes('href'), `pasó un esquema peligroso: ${url} → ${html}`);
  }
});

test('los enlaces buenos sí pasan, con rel en los externos', () => {
  const externo = renderMarkdown('[Brotea](https://brotea.dev)');
  assert.match(externo, /<a href="https:\/\/brotea\.dev" rel="noopener nofollow">Brotea<\/a>/);
  // Uno interno no necesita rel: es nuestro propio sitio.
  assert.match(renderMarkdown('[otra](/noticia/x)'), /<a href="\/noticia\/x">otra<\/a>/);
  assert.match(renderMarkdown('[correo](mailto:a@b.com)'), /href="mailto:a@b\.com"/);
});

test('las comillas dentro del texto no rompen el atributo', () => {
  const html = renderMarkdown('[di "hola"](https://x.com)');
  // El href llega entero y las comillas del texto viajan escapadas: si no lo
  // estuvieran, cerrarían el atributo y todo lo siguiente sería markup vivo.
  assert.match(html, /<a href="https:\/\/x\.com" rel="noopener nofollow">di &quot;hola&quot;<\/a>/);
  assert.ok(!html.includes('">di "hola"'), 'las comillas crudas partirían la etiqueta');
});

test('una entrada vacía o rara no revienta', () => {
  for (const entrada of ['', '   ', null, undefined, '\n\n\n']) {
    assert.doesNotThrow(() => renderMarkdown(entrada));
  }
});

// -- Utilidades ---------------------------------------------------------------
test('los minutos de lectura nunca son cero', () => {
  assert.equal(readingMinutes(''), 1);
  assert.equal(readingMinutes('una palabra'), 1);
  assert.equal(readingMinutes('palabra '.repeat(400)), 2);
});

test('el slug queda limpio y estable', () => {
  assert.equal(slugify('El BCE baja tipos: ¿y ahora qué?'), 'el-bce-baja-tipos-y-ahora-que');
  assert.equal(slugify('  Ñandú   con   espacios  '), 'nandu-con-espacios');
  assert.ok(slugify('a'.repeat(200)).length <= 80, 'un slug no puede crecer sin límite');
});
