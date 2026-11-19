import type { HomeLocaleCopy } from '../types';

/** Direct messages — only what the boot shell paints (the rail label, which is also the bell's
 *  group title). The Messages view's own strings ship inside its lazy chunk (messages-copy.ts). */
export const MESSAGES_COPY: HomeLocaleCopy = {
  en: {
    'nav.messages': 'Messages',
    'msg.someone': 'Someone',
    'msg.newN': '{n} new',
  },
  es: {
    'nav.messages': 'Mensajes',
    'msg.someone': 'Alguien',
    'msg.newN': '{n} nuevos',
  },
};
