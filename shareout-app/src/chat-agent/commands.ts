import type { PlatformId } from '../chat-platforms/types';
import { getPlatform } from '../chat-platforms/registry';
import { t } from '../i18n';
import { type Locale } from '../i18n/locale';

const PROMPTS = {
  en: {
    alerts: 'List my metric alerts.',
    jobs: 'List my scheduled sends.',
    snapshot: (a: string) => `Send me a snapshot image of this page: ${a}`,
    snapshotAsk: 'Send me a snapshot image of a page. Ask which page if you need to.',
    pdf: (a: string) => `Send me a PDF of this page: ${a}`,
    pdfAsk: 'Send me a PDF of a page. Ask which page if you need to.',
    refresh: (a: string) => `Run the live data for this page and summarize the fresh numbers: ${a}`,
    refreshAsk: 'Run live data for a page. Ask which page if you need to.',
    share: (a: string) => `Share a page with these instructions: ${a}`,
    shareAsk: 'Help me share a page. Ask which page and email address if you need to.',
    edit: (a: string) => `Edit a page with these instructions: ${a}`,
    editAsk: 'Help me edit a page. Ask which page and what change if you need to.',
    crew: (a: string) => `Ask the page crew to do this: ${a}`,
    crewAsk: 'Help me ask a page crew to work. Ask which page and task if you need to.',
  },
  es: {
    alerts: 'Mostrame mis alertas de métricas.',
    jobs: 'Mostrame mis envíos programados.',
    snapshot: (a: string) => `Mandame una captura de esta página: ${a}`,
    snapshotAsk: 'Mandame una captura de una página. Si hace falta, preguntame cuál.',
    pdf: (a: string) => `Mandame un PDF de esta página: ${a}`,
    pdfAsk: 'Mandame un PDF de una página. Si hace falta, preguntame cuál.',
    refresh: (a: string) => `Traé los datos al día de esta página y resumime los números nuevos: ${a}`,
    refreshAsk: 'Traé los datos al día de una página. Si hace falta, preguntame cuál.',
    share: (a: string) => `Compartí una página con estas indicaciones: ${a}`,
    shareAsk: 'Ayudame a compartir una página. Si hace falta, preguntame cuál y a qué mail.',
    edit: (a: string) => `Cambiá una página con estas indicaciones: ${a}`,
    editAsk: 'Ayudame a cambiar una página. Si hace falta, preguntame cuál y qué querés cambiar.',
    crew: (a: string) => `Pedile al agente de la página que haga esto: ${a}`,
    crewAsk: 'Ayudame a pedirle algo al agente de una página. Si hace falta, preguntame cuál y qué tarea.',
  },
};

/** Map a slash/agent command name to an agent prompt, or null if unknown. */
export function commandToAgentPrompt(command: string, args: string, locale: Locale = 'en'): string | null {
  const p = t(locale, PROMPTS);
  switch (command) {
    case 'alerts':
      return p.alerts;
    case 'schedules':
    case 'jobs':
      return p.jobs;
    case 'snapshot':
      return args ? p.snapshot(args) : p.snapshotAsk;
    case 'pdf':
      return args ? p.pdf(args) : p.pdfAsk;
    case 'refresh':
      return args ? p.refresh(args) : p.refreshAsk;
    case 'share':
      return args ? p.share(args) : p.shareAsk;
    case 'edit':
      return args ? p.edit(args) : p.editAsk;
    case 'crew':
      return args ? p.crew(args) : p.crewAsk;
    default:
      return null;
  }
}

export function botFeatureFlag(platform: PlatformId): string {
  if (platform === 'web') return 'ai.web_agent';
  return getPlatform(platform)?.featureFlag ?? `ai.${platform}_bot`;
}

const DISABLED = {
  en: {
    slack: 'The Slack assistant isn’t enabled for your account right now.',
    web: 'The workspace assistant isn’t available here.',
    telegram: 'The Telegram assistant isn’t enabled for your account right now.',
  },
  es: {
    slack: 'El asistente de Slack no está activado para tu cuenta por ahora.',
    web: 'El asistente del espacio no está disponible acá.',
    telegram: 'El asistente de Telegram no está activado para tu cuenta por ahora.',
  },
};

export function botDisabledMessage(platform: PlatformId, locale: Locale = 'en'): string {
  const d = t(locale, DISABLED);
  return platform === 'slack' ? d.slack : platform === 'web' ? d.web : d.telegram;
}
