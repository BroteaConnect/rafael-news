// Agrupar por día es donde viven los errores de un día de más o de menos, y en
// un medio eso significa la portada de hoy partida en dos. Se prueba con horas
// frontera reales, no con mediodías cómodos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from '../lib/load-ts.mjs';

const { ZONA, dayKey, dayLabel, groupByDay } = await loadTs(new URL('../lib/dates.ts', import.meta.url));

test('el día se calcula en la zona del medio, no en UTC', () => {
  // 23:30 en Madrid (verano, UTC+2) son las 21:30 UTC del MISMO día.
  assert.equal(dayKey('2026-08-06T21:30:00Z'), '2026-08-06');
  // Pero 00:30 de Madrid son las 22:30 UTC del día ANTERIOR: en UTC esta
  // noticia caería en el 6, y la redacción la publicó ya el 7.
  assert.equal(dayKey('2026-08-06T22:30:00Z'), '2026-08-07');
});

test('también en invierno, cuando el desfase cambia', () => {
  // En enero Madrid es UTC+1: 23:30 UTC siguen siendo las 00:30 del día siguiente.
  assert.equal(dayKey('2026-01-15T23:30:00Z'), '2026-01-16');
  assert.equal(dayKey('2026-01-15T22:30:00Z'), '2026-01-15');
});

test('agrupa consecutivos y respeta el orden de entrada', () => {
  const items = [
    { id: 'a', at: '2026-08-07T08:00:00Z' },
    { id: 'b', at: '2026-08-07T06:00:00Z' },
    { id: 'c', at: '2026-08-06T10:00:00Z' },
  ];
  const grupos = groupByDay(items, (i) => i.at);
  assert.deepEqual(grupos.map((g) => g.dia), ['2026-08-07', '2026-08-06']);
  assert.deepEqual(grupos[0].items.map((i) => i.id), ['a', 'b'], 'no reordena dentro del grupo');
});

test('sin elementos no hay grupos, y uno solo es un grupo', () => {
  assert.deepEqual(groupByDay([], (i) => i.at), []);
  assert.equal(groupByDay([{ at: '2026-08-07T08:00:00Z' }], (i) => i.at).length, 1);
});

test('«hoy» y «ayer» se calculan contra la misma zona', () => {
  const t = (k) => ({ 'date.today': 'Hoy', 'date.yesterday': 'Ayer' }[k] ?? k);
  // Son las 00:30 de Madrid del día 7 (22:30 UTC del 6).
  const ahora = new Date('2026-08-06T22:30:00Z');
  assert.equal(dayLabel('es-ES', '2026-08-07', t, ahora), 'Hoy');
  assert.equal(dayLabel('es-ES', '2026-08-06', t, ahora), 'Ayer');
});

test('un día más antiguo se escribe, y en el idioma que toca', () => {
  const t = (k) => k;
  const ahora = new Date('2026-08-07T10:00:00Z');
  const es = dayLabel('es-ES', '2026-08-01', t, ahora);
  const en = dayLabel('en-GB', '2026-08-01', t, ahora);
  assert.match(es, /agosto/, `en español debería decir el mes: ${es}`);
  assert.match(en, /August/, `en inglés debería decir el mes: ${en}`);
  // La etiqueta tiene que coincidir con el día que encabeza, no con el
  // anterior: es el fallo clásico de formatear la medianoche UTC.
  assert.match(es, /\b1\b/, `debería decir el día 1: ${es}`);
  assert.match(en, /\b1\b/, `debería decir el día 1: ${en}`);
});

test('la zona es un dato, no una suposición cableada', () => {
  assert.equal(ZONA, 'Europe/Madrid');
  assert.equal(dayKey('2026-08-06T22:30:00Z', 'UTC'), '2026-08-06', 'con otra zona, otro día');
});
