// El único sitio de la app que habla con SMTP.
//
// Por SMTP y no por API REST: la API de Brevo devuelve 401 desde IPs no
// listadas mientras SMTP sigue funcionando, y ya nos costó un rato una vez.
import { createTransport, type Transporter } from 'nodemailer';

const HOST = process.env.SMTP_HOST;
const PORT = Number(process.env.SMTP_PORT ?? 587);
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const FROM = process.env.MAIL_FROM ?? 'no-reply@brotea.dev';

export const configured = (): boolean => Boolean(HOST && USER && PASS);

let transport: Transporter | null = null;
const getTransport = (): Transporter => (transport ??= createTransport({
  host: HOST, port: PORT, secure: PORT === 465, auth: { user: USER, pass: PASS },
}));

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface Mail {
  to: string;
  subject: string;
  /** cuerpo en texto plano, línea a línea */
  lines: string[];
  ctaText?: string;
  ctaUrl?: string;
  footer?: string;
}

/**
 * Envía y devuelve si se pudo. NUNCA lanza: que el proveedor de correo falle no
 * puede convertirse en un error de cara a quien rellenó un formulario y no
 * tiene ni culpa ni forma de arreglarlo. Quien llama decide qué contar.
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  if (!configured()) {
    console.warn('[correo] SMTP sin configurar: no se envía', JSON.stringify(mail.subject));
    return false;
  }
  // Texto plano SIEMPRE, y el HTML como cortesía: un correo solo-HTML lo filtra
  // media internet y no se lee bien en un lector de pantalla.
  const text = mail.lines.join('\n');
  const html = [
    ...mail.lines.filter(Boolean).map((l) => `<p>${escape(l)}</p>`),
    mail.ctaUrl && mail.ctaText ? `<p><a href="${escape(mail.ctaUrl)}">${escape(mail.ctaText)}</a></p>` : '',
    mail.footer ? `<p style="color:#5F5D55;font-size:14px">${escape(mail.footer)}</p>` : '',
  ].filter(Boolean).join('\n');

  try {
    await getTransport().sendMail({ from: FROM, to: mail.to, subject: mail.subject, text, html });
    return true;
  } catch (error) {
    console.error('[correo] no se pudo enviar:', (error as Error).message);
    return false;
  }
}
