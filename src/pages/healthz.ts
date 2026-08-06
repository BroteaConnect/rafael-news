import type { APIRoute } from 'astro';

// El contrato de servicio que comprueba el gate de la fábrica (gate 1.2.0:
// `runtime.health` en brotea.json) y, en producción, Coolify.
//
// Regla dura: esta ruta NO puede depender de nada externo. Si consultara la
// base de datos, un corte de red del runner tumbaría el CI y un reinicio de
// Postgres marcaría la app como caída aunque siguiera sirviendo la portada
// desde la instantánea en memoria. Comprueba que el proceso está vivo y sirve,
// que es exactamente lo que se le pregunta.
// Explícito aunque la salida ya sea de servidor: si algún día la app vuelve a
// prerenderizar por defecto, esta ruta tiene que seguir respondiendo en vivo.
export const prerender = false;

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({ ok: true, commit: import.meta.env.PUBLIC_BUILD_COMMIT ?? null }),
    { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
