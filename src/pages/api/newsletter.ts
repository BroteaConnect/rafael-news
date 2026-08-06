import type { APIRoute } from 'astro';
import { DEFAULT_LOCALE, isLocale, t } from '../../lib/i18n';

// Alta al boletín. El navegador habla SOLO con nosotros y es el servidor quien
// reenvía el correo: así el destino real no viaja en el HTML, no hay CORS que
// negociar y cambiar de proveedor no obliga a re-desplegar el front.
//
// F2 puede sustituir el reenvío por una tabla de suscriptores propia sin tocar
// ni el componente ni esta URL.
export const prerender = false;

// `||` y nunca `??`: el ARG del Dockerfile vale "" por defecto, que NO es
// nullish, así que `??` dejaría el alta apuntando a la cadena vacía en
// cualquier build que no traiga la variable. El default compilado lo hace
// imposible y el Dockerfile comprueba que viaja dentro del bundle.
const ENDPOINT = (import.meta.env.PUBLIC_REQUIREMENTS_ENDPOINT ?? '').trim()
  || 'https://api.brotea.dev/requirements';

// Validación deliberadamente laxa: aquí solo se descartan los disparates
// (sin arroba, sin dominio, con espacios). Quién es dueño del buzón lo decide
// el correo de confirmación, no una expresión regular.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request }) => {
  const payload = (await request.json().catch(() => null)) as
    { email?: unknown; locale?: unknown } | null;

  const locale = isLocale(payload?.locale) ? String(payload?.locale) : DEFAULT_LOCALE;
  const email = typeof payload?.email === 'string' ? payload.email.trim() : '';

  if (!LOOKS_LIKE_EMAIL.test(email) || email.length > 200) {
    return json({ message: t(locale, 'newsletter.invalid') }, 400);
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: 'rafael-news',
        source: 'newsletter',
        submitted_by: email,
        content: `newsletter subscription (${locale})`,
      }),
      // Sin límite de tiempo, una caída del receptor deja la petición del
      // lector colgada hasta que se aburre y recarga.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
  } catch (error) {
    console.error('[newsletter] no se pudo registrar el alta:', error);
    return json({ message: t(locale, 'newsletter.error') }, 502);
  }

  // 202 y no 201: aceptamos el alta, pero quien la confirma es el correo de
  // doble opt-in, así que todavía no existe un recurso «suscriptor».
  return json({ message: t(locale, 'newsletter.thanks') }, 202);
};
