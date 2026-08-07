// Agrupar por día, que suena trivial y no lo es.
//
// Las fechas se guardan en UTC. Si se agrupa en UTC, una noticia publicada a
// las 23:30 de Madrid aparece bajo el día siguiente — y la redacción, que
// piensa en su reloj, ve la portada de hoy dividida en dos. Por eso el día se
// calcula SIEMPRE en la zona del medio, no en la del servidor (que en un
// contenedor es UTC) ni en la del navegador (que no existe: esto es servidor).
/** La zona horaria del medio. Brotea News es un medio español. */
export const ZONA = 'Europe/Madrid';

/** `2026-08-06` en la zona del medio, apto para comparar y ordenar. */
export function dayKey(iso: string, zona = ZONA): string {
  // `en-CA` da exactamente AAAA-MM-DD, que es el único formato que se ordena
  // igual como texto que como fecha.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

export interface Grupo<T> { dia: string; items: T[] }

/**
 * Agrupa conservando el orden de entrada. No reordena a propósito: quien llama
 * ya decidió el orden (normalmente, de más reciente a más antigua) y volver a
 * ordenar aquí escondería ese criterio en dos sitios.
 */
export function groupByDay<T>(items: readonly T[], fecha: (item: T) => string, zona = ZONA): Grupo<T>[] {
  const grupos: Grupo<T>[] = [];
  for (const item of items) {
    const dia = dayKey(fecha(item), zona);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.items.push(item);
    else grupos.push({ dia, items: [item] });
  }
  return grupos;
}

/**
 * «Hoy», «Ayer» o la fecha escrita. Recibe la etiqueta Intl ya resuelta
 * (`es-ES`) en vez de importarla del catálogo: así este módulo no depende de
 * nada del proyecto y se puede probar con `node --test` sin Vite detrás, que
 * es exactamente donde corre el gate.
 */
export function dayLabel(
  intlTag: string, dia: string, t: (clave: string) => string, hoy = new Date(), zona = ZONA,
): string {
  const claveHoy = dayKey(hoy.toISOString(), zona);
  const claveAyer = dayKey(new Date(hoy.getTime() - 86400_000).toISOString(), zona);
  if (dia === claveHoy) return t('date.today');
  if (dia === claveAyer) return t('date.yesterday');
  // `T12:00:00Z` y no medianoche: con medianoche UTC, cualquier zona al oeste
  // retrocede un día y la etiqueta contradice al grupo que encabeza.
  return new Intl.DateTimeFormat(intlTag, {
    timeZone: zona, weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(`${dia}T12:00:00Z`));
}
