/** What a durable page build tells its user, in their language (Spanish says "artefacto", as the Home UI does). */
import type { LocaleCopy } from '../i18n';

export const BUILD_JOB_COPY: LocaleCopy<{
  /** A second, different build while one is still running. */
  busy: string;
  /** The notification line for a page that finished while nobody was watching. */
  ready: string;
  /** The notification line for a build that did not produce a page. */
  notFinished: string;
  interrupted: string;
  timeout: string;
  cancelled: string;
  generic: string;
}> = {
  en: {
    busy: 'You already have a page building. I’ll let you know when it’s done, then you can start the next one.',
    ready: 'Your page is ready',
    notFinished: 'Your page build didn’t finish',
    interrupted: 'The build was interrupted before it finished. Try again.',
    timeout: 'The build took too long, so I stopped it. Try a simpler version, or build it in parts.',
    cancelled: 'Build stopped.',
    generic: 'Something went wrong with the build. Try again.',
  },
  es: {
    busy: 'Ya tenés un artefacto armándose. Te aviso cuando termine y ahí podés arrancar el siguiente.',
    ready: 'Tu artefacto está listo',
    notFinished: 'Tu artefacto no se terminó de armar',
    interrupted: 'El armado se interrumpió antes de terminar. Probá de nuevo.',
    timeout: 'El armado tardó demasiado, así que lo frené. Probá con una versión más simple o armala por partes.',
    cancelled: 'Armado detenido.',
    generic: 'Algo salió mal con el armado. Probá de nuevo.',
  },
};
