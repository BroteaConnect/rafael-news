// Correos de la redacción. Reutiliza el transporte SMTP del boletín: son las
// mismas credenciales y el mismo remitente, y tener dos configuraciones para
// mandar correo desde la misma app es cómo acaban divergiendo.
import { sendMail } from '../mail/transport';
import { t } from '../i18n';

/** Invitación a la redacción. Devuelve si se pudo enviar: si el correo falla,
 *  la invitación EXISTE igualmente en la base y el owner puede reenviarla —
 *  perder la invitación por un fallo de SMTP sería peor. */
export async function sendInvite(email: string, locale: string, url: string): Promise<boolean> {
  return sendMail({
    to: email,
    subject: t(locale, 'mail.invite.subject'),
    lines: [
      t(locale, 'mail.invite.greeting'),
      '',
      t(locale, 'mail.invite.body'),
      '',
      url,
      '',
      t(locale, 'mail.invite.expires'),
    ],
    ctaText: t(locale, 'mail.invite.cta'),
    ctaUrl: url,
    footer: t(locale, 'mail.invite.ignore'),
  });
}

export async function sendReset(email: string, locale: string, url: string): Promise<boolean> {
  return sendMail({
    to: email,
    subject: t(locale, 'mail.reset.subject'),
    lines: [t(locale, 'mail.reset.greeting'), '', t(locale, 'mail.reset.body'), '', url],
    ctaText: t(locale, 'mail.reset.cta'),
    ctaUrl: url,
    footer: t(locale, 'mail.reset.ignore'),
  });
}
