import type { LocaleCopy } from '../../i18n';

/** Telegram bot copy for page links and open buttons. */
export const TELEGRAM_LINK_COPY: LocaleCopy<{
  openPage: string;
  openHeading: string;
  openN: (n: number) => string;
}> = {
  en: {
    openPage: 'Open Page',
    openHeading: 'Open in ShareOut — one tap signs you in:',
    openN: (n) => `Open page ${n}`,
  },
  es: {
    openPage: 'Abrir página',
    openHeading: 'Abrir en ShareOut — un toque inicia tu sesión:',
    openN: (n) => `Abrir página ${n}`,
  },
};
