// El correo de confirmación. Por SMTP y no por API REST: la API de Brevo
// devuelve 401 desde IPs no listadas mientras SMTP sigue funcionando, y ya nos
// costó un rato descubrirlo una vez.
//
// El texto es COPIA y sale de los diccionarios, no de una plantilla incrustada
// aquí: un correo que solo existe en español es la mitad de un portal bilingüe.
import { createTransport, type Transporter } from 'nodemailer';
import { t } from '../i18n';

const HOST = process.env.SMTP_HOST;
const PORT = Number(process.env.SMTP_PORT ?? 587);
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const FROM = process.env.MAIL_FROM ?? 'no-reply@brotea.dev';

export const configured = (): boolean => Boolean(HOST && USER && PASS);

let transport: Transporter | null = null;
const getTransport = (): Transporter => (transport ??= createTransport({
  host: HOST, port: PORT, secure: PORT === 465,
  auth: { user: USER, pass: PASS },
}));

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Envía el correo de confirmación. Devuelve si se pudo o no; NUNCA lanza: que
 * el proveedor de correo falle no puede convertirse en un error de cara al
 * lector, que no tiene culpa ni forma de arreglarlo.
 */
export async function sendConfirmation(
  email: string, locale: string, confirmUrl: string,
): Promise<boolean> {
  if (!configured()) {
    console.warn('[boletin] SMTP sin configurar: no se envía la confirmación');
    return false;
  }
  const subject = t(locale, 'mail.confirm.subject');
  const text = [
    t(locale, 'mail.confirm.greeting'),
    '',
    t(locale, 'mail.confirm.body'),
    '',
    confirmUrl,
    '',
    t(locale, 'mail.confirm.ignore'),
  ].join('\n');

  // Texto plano SIEMPRE, y el HTML como cortesía: un correo solo-HTML lo filtra
  // media internet y no se lee en un lector de pantalla de texto.
  const html = `<p>${escape(t(locale, 'mail.confirm.greeting'))}</p>
<p>${escape(t(locale, 'mail.confirm.body'))}</p>
<p><a href="${escape(confirmUrl)}">${escape(t(locale, 'mail.confirm.cta'))}</a></p>
<p style="color:#5F5D55;font-size:14px">${escape(t(locale, 'mail.confirm.ignore'))}</p>`;

  try {
    await getTransport().sendMail({ from: FROM, to: email, subject, text, html });
    return true;
  } catch (error) {
    console.error('[boletin] no se pudo enviar la confirmación:', (error as Error).message);
    return false;
  }
}
