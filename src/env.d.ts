/// <reference types="astro/client" />

// El SQL de las migraciones se importa con `?raw` para que viaje DENTRO del
// bundle del servidor: la imagen de producción solo copia dist/, así que un
// fichero suelto del repo no llegaría y la migración fallaría únicamente en
// producción, que es el peor sitio para descubrirlo.
declare module '*.sql?raw' {
  const contents: string;
  export default contents;
}
