// El correo de confirmación del boletín. El transporte es el común
// (../mail/transport): tener dos configuraciones SMTP en la misma app es cómo
// acaban divergiendo y cómo una de las dos deja de funcionar sin que nadie lo
// note.
//
// El texto es COPIA y sale de los diccionarios: un correo que solo existe en
// español es la mitad de un portal bilingüe.
import { sendMail } from '../mail/transport';
import { t } from '../i18n';

export { configured } from '../mail/transport';

export async function sendConfirmation(
  email: string, locale: string, confirmUrl: string,
): Promise<boolean> {
  return sendMail({
    to: email,
    subject: t(locale, 'mail.confirm.subject'),
    lines: [
      t(locale, 'mail.confirm.greeting'),
      '',
      t(locale, 'mail.confirm.body'),
      '',
      confirmUrl,
    ],
    ctaText: t(locale, 'mail.confirm.cta'),
    ctaUrl: confirmUrl,
    footer: t(locale, 'mail.confirm.ignore'),
  });
}
