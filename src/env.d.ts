/// <reference types="astro/client" />

// El SQL de las migraciones se importa con `?raw` para que viaje DENTRO del
// bundle del servidor: la imagen de producción solo copia dist/, así que un
// fichero suelto del repo no llegaría y la migración fallaría únicamente en
// producción, que es el peor sitio para descubrirlo.
declare module '*.sql?raw' {
  const contents: string;
  export default contents;
}

// La sesión de la redacción, puesta por el middleware en CADA petición. Es
// `null` para el público: una página de /admin nunca tiene que preguntarse si
// el objeto existe, solo si hay alguien dentro.
declare namespace App {
  interface Locals {
    user: import('./lib/auth/store').SessionUser | null;
    /** el cuerpo del POST, leído UNA vez por el middleware (ver su comentario) */
    form: FormData | null;
  }
}
