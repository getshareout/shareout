import { t, type Locale } from '../i18n';

const REPLIES = {
  en: {
    gaveUp: 'I looked into that but couldn’t wrap it up. Try narrowing the question?',
    errored: 'Hmm, something went wrong on my end. Mind trying again?',
    empty: 'I didn’t quite get that. Try rephrasing?',
  },
  es: {
    gaveUp: 'Lo estuve mirando pero no llegué a cerrarlo. ¿Probás con una pregunta más acotada?',
    errored: 'Uy, algo falló de mi lado. ¿Probás de nuevo?',
    empty: 'No terminé de entenderte. ¿Me lo decís de otra forma?',
  },
};

/** Canned replies for when the model can't answer, in the user's language. */
export function agentFallbackReplies(locale: Locale = 'en') {
  return t(locale, REPLIES);
}
