import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../lib/auth/core';
import { audit, logout } from '../../lib/auth/store';

// Salir es POST, no GET, y el middleware ya le exigió el token CSRF. Un GET que
// cierra sesión lo dispara cualquier <img> de un correo o de otra web: molesto
// más que peligroso, pero es molestia gratis.
export const prerender = false;

export const POST: APIRoute = async ({ cookies, locals, redirect, request }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    await logout(token);
    await audit('logout', locals.user?.id ?? null, {},
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim());
  }
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return redirect('/admin/entrar', 303);
};
