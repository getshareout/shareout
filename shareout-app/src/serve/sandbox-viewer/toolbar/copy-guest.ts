import type { LocaleCopy } from '../../../i18n';

// "Comment as guest" copy for the viewer toolbar. Same rules as copy.ts: trusted
// constants interpolated into HTML and single-quoted JS, so no quotes, backslashes or
// HTML specials.

const en = {
  guestTitle: 'Comment as guest',
  guestIntro: 'No account needed. We email you a code to confirm it is you.',
  guestName: 'Your name',
  guestEmail: 'Your email',
  guestSendCode: 'Email me a code',
  guestCode: '6-digit code',
  guestConfirm: 'Confirm',
  guestCodeSent: 'Code sent. Check your inbox.',
  guestNeedFields: 'Add your name and email.',
  guestWrongCode: 'That code did not work. Try again or ask for a new one.',
  guestTooMany: 'Too many tries. Wait a bit and try again.',
  guestSendFail: 'We could not send the code. Try again.',
  guestAs: 'Commenting as',
  guestBadge: 'guest',
  guestNotYou: 'Not you?',
  guestNeedVerify: 'Confirm your email to comment.',
  guestExpired: 'Your guest session ended. Confirm your email again.',
};

export type GuestCopy = typeof en;

const es: GuestCopy = {
  guestTitle: 'Comentá como invitado',
  guestIntro: 'No hace falta una cuenta. Te mandamos un código por mail para confirmar que sos vos.',
  guestName: 'Tu nombre',
  guestEmail: 'Tu email',
  guestSendCode: 'Mandame un código',
  guestCode: 'Código de 6 dígitos',
  guestConfirm: 'Confirmar',
  guestCodeSent: 'Listo, te mandamos el código. Revisá tu mail.',
  guestNeedFields: 'Completá tu nombre y tu email.',
  guestWrongCode: 'Ese código no funcionó. Probá de nuevo o pedí uno nuevo.',
  guestTooMany: 'Demasiados intentos. Esperá un rato y probá de nuevo.',
  guestSendFail: 'No pudimos mandar el código. Probá de nuevo.',
  guestAs: 'Comentás como',
  guestBadge: 'invitado',
  guestNotYou: '¿No sos vos?',
  guestNeedVerify: 'Confirmá tu email para comentar.',
  guestExpired: 'Se terminó tu sesión de invitado. Confirmá tu email de nuevo.',
};

export const GUEST_COPY: LocaleCopy<GuestCopy> = { en, es };
