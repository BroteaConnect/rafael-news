#!/usr/bin/env node
// gate-web.mjs — el gate de velocidad y accesibilidad del portal.
//
// «La web tiene que ir rápida» era un requisito del encargo, y hasta hoy no
// había forma de que dejara de cumplirse sin que nadie se enterara. Esto lo
// convierte en algo que falla una PR.
//
// Arranca el servidor REAL construido y le hace preguntas por HTTP. Sin
// DATABASE_URL a propósito: así sirve la semilla, y la medida es la misma hoy
// que dentro de seis meses — un gate cuyo resultado depende de cuántas
// noticias haya publicadas no sirve para comparar.
//
// Lo que NO mide: LCP, CLS ni nada que necesite un navegador de verdad. Eso
// es otro trabajo (y otro coste en CI); aquí está lo que se puede comprobar
// con certeza y sin depender de la carga del runner. Medir el peso, que es la
// causa de casi todo lo demás, sí se puede hacer exacto.
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.GATE_PORT ?? 41999);
const BASE = `http://127.0.0.1:${PORT}`;

// Presupuestos. Salen de medir lo que hay hoy y dejar holgura para crecer un
// poco, no de un número redondo bonito: un presupuesto que ya se incumple el
// día que se escribe se desactiva a la semana.
const PRESUPUESTO = {
  '/':                       { html: 14_000, js: 6_000, css: 6_000 },
  '/noticias':               { html: 12_000, js: 6_000, css: 6_000 },
  '/noticia/bce-tipos-septiembre': { html: 12_000, js: 6_000, css: 6_000 },
  '/admin/entrar':           { html: 6_000,  js: 2_000, css: 6_000 },
};

const PAGINAS_PUBLICAS = ['/', '/noticias', '/temas', '/tema/cripto', '/noticia/bce-tipos-septiembre', '/autor/rafael-ojeda', '/legal', '/en/'];

const gz = (s) => gzipSync(Buffer.from(s, 'utf8')).length;
const fallos = [];
const fallo = (ruta, msg) => fallos.push(`${ruta}: ${msg}`);

async function texto(ruta) {
  const res = await fetch(BASE + ruta, { redirect: 'manual' });
  return { res, body: res.status === 200 ? await res.text() : '' };
}

/** Peso real de una página: su HTML más TODO lo que referencia, comprimido. */
async function pesar(ruta, html) {
  const assets = { js: 0, css: 0 };
  // Scripts en línea (Astro incrusta los pequeños) y hojas de estilo en línea.
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    // El JSON-LD son datos para buscadores, no código que ejecute el navegador.
    if (/type=["']application\/ld\+json/.test(m[0])) continue;
    assets.js += gz(m[1]);
  }
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) assets.css += gz(m[1]);

  for (const m of html.matchAll(/<(?:script[^>]*\bsrc|link[^>]*\bhref)=["']([^"']+)["']/g)) {
    const url = m[1];
    if (!url.startsWith('/') || url.startsWith('//')) continue;         // externo: no es nuestro peso
    if (!/\.(js|css)$/.test(url)) continue;
    const r = await fetch(BASE + url);
    if (!r.ok) { fallo(ruta, `referencia un asset que no existe: ${url}`); continue; }
    assets[url.endsWith('.js') ? 'js' : 'css'] += gz(await r.text());
  }
  return assets;
}

// -- Accesibilidad estructural -------------------------------------------------
// No sustituye a una auditoría con navegador, pero caza las regresiones que de
// verdad ocurren al editar plantillas: perder el `alt`, quedarse sin `label`,
// meter un segundo h1 o saltarse un nivel de encabezado.
function accesibilidad(ruta, html) {
  const h1 = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1 !== 1) fallo(ruta, `tiene ${h1} elementos h1; debe haber exactamente uno`);

  if (!/<html[^>]*\blang=["'][a-z]{2}/i.test(html)) fallo(ruta, 'el <html> no declara idioma');

  for (const img of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt=/.test(img[0])) fallo(ruta, `una imagen sin alt: ${img[0].slice(0, 60)}…`);
  }

  // Controles sin etiqueta. Se excluyen los ocultos y los botones, que se
  // etiquetan con su propio texto.
  //
  // Cuentan las TRES formas válidas, no solo `for=`: envolver el control en un
  // <label> es correcto y accesible, y exigir `for=` marcaba como error un
  // formulario perfectamente etiquetado. Lo dijo este mismo gate la primera vez
  // que corrió, y el error estaba aquí, no en la página.
  const dentroDeLabel = [...html.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/g)].map((m) => m[0]);
  for (const input of html.matchAll(/<(input|textarea|select)\b[^>]*>/g)) {
    const tag = input[0];
    if (/\btype=["'](hidden|submit|button)["']/.test(tag)) continue;
    const id = /\bid=["']([^"']+)["']/.exec(tag)?.[1];
    const etiquetado = (id && new RegExp(`<label[^>]*\\bfor=["']${id}["']`).test(html))
      || /\baria-label=/.test(tag)
      || /\baria-labelledby=/.test(tag)
      || dentroDeLabel.some((label) => label.includes(tag));
    if (!etiquetado) fallo(ruta, `un ${input[1]} sin etiqueta: ${tag.slice(0, 70)}…`);
  }

  // Orden de encabezados: saltar de h2 a h4 deja a quien navega por
  // encabezados sin saber si se ha perdido una sección.
  const niveles = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
  for (let i = 1; i < niveles.length; i += 1) {
    if (niveles[i] - niveles[i - 1] > 1) {
      fallo(ruta, `salto de encabezado h${niveles[i - 1]} → h${niveles[i]}`);
      break;
    }
  }
}

async function main() {
  const server = spawn('node', ['./dist/server/entry.mjs'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(PORT), DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  server.stdout.on('data', (d) => logs.push(String(d)));
  server.stderr.on('data', (d) => logs.push(String(d)));

  try {
    for (let i = 0; i < 60; i += 1) {
      try { await fetch(BASE + '/healthz'); break; } catch { await sleep(500); }
      if (i === 59) throw new Error(`el servidor no arrancó:\n${logs.join('')}`);
    }

    console.log('peso por página (comprimido)\n');
    console.log('página'.padEnd(34), 'html'.padStart(8), 'js'.padStart(8), 'css'.padStart(8));
    for (const [ruta, limite] of Object.entries(PRESUPUESTO)) {
      const { res, body } = await texto(ruta);
      if (res.status !== 200) { fallo(ruta, `devolvió ${res.status}`); continue; }
      const peso = await pesar(ruta, body);
      const html = gz(body);
      const marca = (real, max) => (real > max ? `${real}✗` : String(real));
      console.log(ruta.padEnd(34), marca(html, limite.html).padStart(8),
        marca(peso.js, limite.js).padStart(8), marca(peso.css, limite.css).padStart(8));
      if (html > limite.html) fallo(ruta, `HTML ${html} B > ${limite.html} B`);
      if (peso.js > limite.js) fallo(ruta, `JS ${peso.js} B > ${limite.js} B`);
      if (peso.css > limite.css) fallo(ruta, `CSS ${peso.css} B > ${limite.css} B`);
    }

    console.log('\naccesibilidad estructural y cabeceras');
    for (const ruta of PAGINAS_PUBLICAS) {
      const { res, body } = await texto(ruta);
      if (res.status !== 200) { fallo(ruta, `devolvió ${res.status}`); continue; }
      accesibilidad(ruta, body);
      const cache = res.headers.get('cache-control') ?? '';
      if (!/s-maxage=\d+/.test(cache)) fallo(ruta, `sin caché compartida: "${cache}"`);
      if (!res.headers.get('etag')) fallo(ruta, 'sin ETag: cada visita se descarga entera');
    }

    // La parte privada no puede acabar en una caché compartida ni en un buscador.
    for (const ruta of ['/admin/entrar']) {
      const { res, body } = await texto(ruta);
      accesibilidad(ruta, body);
      if (!/no-store/.test(res.headers.get('cache-control') ?? '')) fallo(ruta, 'debería ser no-store');
      if (!/noindex/.test(res.headers.get('x-robots-tag') ?? '')) fallo(ruta, 'debería ser noindex');
    }

    // El panel de la redacción no puede filtrar su JavaScript al público: la
    // forma más segura de garantizarlo es que no exista ninguno.
    const { body: portada } = await texto('/');
    if (/\/admin\//.test(portada.replace(/href="\/admin[^"]*"/g, ''))) {
      fallo('/', 'la portada referencia algo de /admin');
    }

    const { res: salud } = await texto('/healthz');
    if (salud.headers.get('etag')) fallo('/healthz', 'no debe llevar ETag');
  } finally {
    server.kill('SIGTERM');
  }

  if (fallos.length) {
    console.error(`\n✖ ${fallos.length} problema(s):`);
    for (const f of fallos) console.error(`  · ${f}`);
    process.exit(1);
  }
  console.log('\n✓ dentro de presupuesto y sin problemas estructurales');
}

await main();
