import type { APIRoute } from 'astro';
import { MAX_EMAIL, RateLimiter, normalizeEmail } from '../../lib/newsletter/core';
import { configured as dbConfigured, signup } from '../../lib/newsletter/store';
import { sendConfirmation } from '../../lib/newsletter/mail';
import { DEFAULT_LOCALE, isLocale, localePath, t } from '../../lib/i18n';

// Alta al boletín, con doble opt-in. Hasta aquí el correo se reenviaba al
// recolector de requisitos de la fábrica: funcionaba, pero no era un alta —
// nadie confirmaba nada y no había forma de darse de baja.
export const prerender = false;

// Guardar un correo es barato; ENVIARLO no. Y una lista de correo es un arma si
// cualquiera puede disparar mil envíos a direcciones ajenas desde un formulario
// público: se limita por IP y también por dirección.
const byIp = new RateLimiter(5, 60_000);
const byEmail = new RateLimiter(3, 3600_000);

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request, clientAddress, site }) => {
  const payload = (await request.json().catch(() => null)) as
    { email?: unknown; locale?: unknown } | null;

  const locale = isLocale(payload?.locale) ? String(payload?.locale) : DEFAULT_LOCALE;
  const email = normalizeEmail(payload?.email);
  if (!email) return json({ message: t(locale, 'newsletter.invalid') }, 400);

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientAddress || 'desconocida';
  if (byIp.limited(ip) || byEmail.limited(email)) {
    return json({ message: t(locale, 'newsletter.too-many') }, 429);
  }

  if (!dbConfigured()) {
    console.error('[boletin] sin DATABASE_URL: no se puede dar de alta a nadie');
    return json({ message: t(locale, 'newsletter.error') }, 503);
  }

  try {
    const { result, token } = await signup(email, locale, 'portada');
    if (result === 'sent' && token) {
      const origin = site?.origin ?? new URL(request.url).origin;
      const url = new URL(localePath(locale, '/boletin/confirmar'), origin);
      url.searchParams.set('t', token);
      await sendConfirmation(email, locale, url.href);
    }
    // La MISMA respuesta para un alta nueva y para un correo ya confirmado: si
    // distinguiera, este formulario diría a cualquiera quién está suscrito.
    // 202 y no 201: aceptamos la petición, pero el suscriptor no existe hasta
    // que alguien pincha el enlace que solo llega a su buzón.
    return json({ message: t(locale, 'newsletter.thanks') }, 202);
  } catch (error) {
    console.error('[boletin] fallo al dar de alta:', (error as Error).message);
    return json({ message: t(locale, 'newsletter.error') }, 500);
  }
};

// Un GET a esta ruta es casi siempre alguien probando: se responde algo útil
// en vez de un 404 que parezca que el portal está roto.
export const GET: APIRoute = () =>
  json({ message: 'POST {email, locale}', max_email: MAX_EMAIL }, 405);
