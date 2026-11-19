import type { LocaleCopy } from '../../i18n';

/** What the Telegram and WhatsApp bots say outside the agent: the same words on both, `app` names the one in use. */
export interface BotCopy {
  help: (app: string) => string;
  notLinked: (url: string) => string;
  welcomeNoCode: (url: string) => string;
  codeExpired: (url: string) => string;
  linked: (who: string, app: string) => string;
  unlinked: string;
  unknownCommand: (name: string) => string;
  pickWorkspace: string;
  pickWorkspaceList: (names: string) => string;
  workspaceButton: string;
  workspaceSet: (name: string) => string;
  workspaceNotFound: (names: string) => string;
  workspaceGone: string;
  oneWorkspaceOnly: string;
  noWorkspace: string;
  notEnabled: (app: string) => string;
  currentWorkspace: (name: string) => string;
  status: (email: string, workspace: string, count: number) => string;
  noneSelected: string;
  noPages: (scope: string, host: string) => string;
  noMatches: (query: string, scope: string) => string;
  searchHint: string;
  pagesIn: (scope: string) => string;
  matchesIn: (query: string, scope: string) => string;
  showing: (n: number) => string;
  supportHint: string;
  supportOpened: string;
  supportOpenedByEmail: string;
  pageNotFound: string;
  rendering: (pdf: boolean) => string;
  sent: (pdf: boolean) => string;
  adminOnly: string;
  heard: (text: string) => string;
}

export const BOT_COPY: LocaleCopy<BotCopy> = {
  en: {
    help: (app) => [
      `I'm your ShareOut assistant in ${app}. I can find, read, summarize, and update the pages your ShareOut account can see, in one workspace at a time.`,
      '',
      'Useful commands:',
      '/workspace - pick the workspace I work in',
      '/artifacts - list pages in the workspace',
      '/search <text> - find a page',
      '/status - show connected account and workspace',
      '/alerts - list metric alerts',
      '/schedules - list scheduled sends',
      '/snapshot <page> - send a page image',
      '/pdf <page> - send a PDF',
      '/refresh <page> - run live data if available',
      '/share <page> with <email> - share a page',
      '/edit <page>: <change> - propose a page edit',
      '/crew <page>: <task> - ask a page crew to work',
      '/support <what went wrong> - open a support ticket',
      '/settings - open the connection settings',
      '/unlink - disconnect this chat',
      '',
      'You can also type normally, like "summarize the adoption report", "what changed in the sales dashboard?" or "where do our procedures cover returns?" (I answer with the page, the section and a link that opens right there).',
    ].join('\n'),
    notLinked: (url) => `Let’s connect your account first. Open ${url} and tap the button. Takes a few seconds.`,
    welcomeNoCode: (url) => `Welcome to ShareOut. Connect your account first: open ${url} and tap the button there.`,
    codeExpired: (url) => `That link expired. Grab a fresh one at ${url}`,
    linked: (who, app) => `You’re connected${who ? ` as ${who}` : ''}.\n\nWelcome to ShareOut in ${app}. Ask me about your pages, or start with /artifacts.`,
    unlinked: 'Done — this chat is no longer linked to your ShareOut account.',
    unknownCommand: (name) => `I don’t know /${name} yet. Try /help to see what I can do.`,
    pickWorkspace: 'Which workspace should I work in?',
    pickWorkspaceList: (names) => `Which workspace should I work in? Reply with /workspace and its name:\n${names}`,
    workspaceButton: 'Workspaces',
    workspaceSet: (name) => `Done — I’ll work in ${name}. Try /artifacts or ask a question.`,
    workspaceNotFound: (names) => `I couldn’t find that workspace. Available workspaces: ${names}.`,
    workspaceGone: 'Workspace not found.',
    oneWorkspaceOnly: 'I work inside one workspace at a time. Use /workspace to switch.',
    noWorkspace: 'You aren’t a member of any team workspace yet, so there’s nothing for me to work in.',
    notEnabled: (app) => `The ${app} assistant isn’t turned on in your workspace. An admin can turn it on under Admin → Features.`,
    currentWorkspace: (name) => `Current workspace: ${name}.`,
    status: (email, workspace, count) => [
      `Connected as: ${email}`,
      `Current workspace: ${workspace}`,
      `Workspaces: ${count}`,
      '',
      'Use /workspace to switch, /artifacts to list pages, or /help for commands.',
    ].join('\n'),
    noneSelected: 'none yet',
    noPages: (scope, host) => `No pages found in ${scope}. Create one at ${host}.`,
    noMatches: (query, scope) => `No pages matched “${query}” in ${scope}.`,
    searchHint: 'Try /search sales or /search adoption.',
    pagesIn: (scope) => `Your pages in ${scope}:`,
    matchesIn: (query, scope) => `Matches for “${query}” in ${scope}:`,
    showing: (n) => `Showing ${n} page${n === 1 ? '' : 's'}.`,
    supportHint: 'Tell me what went wrong — e.g. /support Publish button does nothing on my dashboard.',
    supportOpened: 'Got it — your support ticket is open. Our team will reply here.',
    supportOpenedByEmail: 'Got it — your support ticket is open. Our team will reply by email and in ShareOut.',
    pageNotFound: 'Page not found.',
    rendering: (pdf) => (pdf ? 'Rendering PDF…' : 'Rendering snapshot…'),
    sent: (pdf) => (pdf ? 'Sent PDF.' : 'Sent snapshot.'),
    adminOnly: 'This command is only available to platform admins.',
    heard: (text) => `🎙️ “${text}”`,
  },
  es: {
    help: (app) => [
      `Soy tu asistente de ShareOut en ${app}. Encuentro, leo, resumo y actualizo los artefactos que ve tu cuenta de ShareOut, en un espacio a la vez.`,
      '',
      'Comandos útiles:',
      '/workspace - elegir el espacio en el que trabajo',
      '/artifacts - ver los artefactos del espacio',
      '/search <texto> - buscar un artefacto',
      '/status - ver tu cuenta y tu espacio',
      '/alerts - ver tus alertas de métricas',
      '/schedules - ver tus envíos programados',
      '/snapshot <artefacto> - mandar una captura',
      '/pdf <artefacto> - mandar un PDF',
      '/refresh <artefacto> - traer los datos al día',
      '/share <artefacto> with <email> - compartir un artefacto',
      '/edit <artefacto>: <cambio> - proponer un cambio',
      '/crew <artefacto>: <tarea> - pedirle algo al agente del artefacto',
      '/support <qué falló> - abrir un pedido de ayuda',
      '/settings - abrir la configuración de la conexión',
      '/unlink - desconectar este chat',
      '',
      'También podés escribir normal, por ejemplo "resumime el reporte de adopción", "¿qué cambió en el tablero de ventas?" o "¿dónde dicen nuestros procedimientos cómo hacer una devolución?" (te contesto con el artefacto, la sección y un link que abre justo ahí).',
    ].join('\n'),
    notLinked: (url) => `Primero conectemos tu cuenta. Abrí ${url} y tocá el botón. Son unos segundos.`,
    welcomeNoCode: (url) => `Bienvenido a ShareOut. Primero conectá tu cuenta: abrí ${url} y tocá el botón.`,
    codeExpired: (url) => `Ese link venció. Pedí uno nuevo en ${url}`,
    linked: (who, app) => `Listo, quedaste conectado${who ? ` como ${who}` : ''}.\n\nBienvenido a ShareOut en ${app}. Preguntame por tus artefactos, o empezá con /artifacts.`,
    unlinked: 'Listo, este chat ya no está conectado a tu cuenta de ShareOut.',
    unknownCommand: (name) => `Todavía no conozco /${name}. Probá /help para ver lo que puedo hacer.`,
    pickWorkspace: '¿En qué espacio trabajo?',
    pickWorkspaceList: (names) => `¿En qué espacio trabajo? Respondé /workspace y el nombre:\n${names}`,
    workspaceButton: 'Espacios',
    workspaceSet: (name) => `Listo, trabajo en ${name}. Probá /artifacts o haceme una pregunta.`,
    workspaceNotFound: (names) => `No encontré ese espacio. Tus espacios: ${names}.`,
    workspaceGone: 'No encontré ese espacio.',
    oneWorkspaceOnly: 'Trabajo dentro de un espacio a la vez. Usá /workspace para cambiar.',
    noWorkspace: 'Todavía no sos miembro de ningún espacio de equipo, así que no tengo dónde trabajar.',
    notEnabled: (app) => `El asistente de ${app} no está activado en tu espacio. Un admin puede activarlo en Admin → Funciones.`,
    currentWorkspace: (name) => `Espacio actual: ${name}.`,
    status: (email, workspace, count) => [
      `Conectado como: ${email}`,
      `Espacio actual: ${workspace}`,
      `Espacios: ${count}`,
      '',
      'Usá /workspace para cambiar, /artifacts para ver tus artefactos o /help para los comandos.',
    ].join('\n'),
    noneSelected: 'ninguno todavía',
    noPages: (scope, host) => `No hay artefactos en ${scope}. Creá uno en ${host}.`,
    noMatches: (query, scope) => `Ningún artefacto coincide con “${query}” en ${scope}.`,
    searchHint: 'Probá /search ventas o /search adopción.',
    pagesIn: (scope) => `Tus artefactos en ${scope}:`,
    matchesIn: (query, scope) => `Resultados para “${query}” en ${scope}:`,
    showing: (n) => `${n} artefacto${n === 1 ? '' : 's'}.`,
    supportHint: 'Contame qué falló, por ejemplo: /support El botón Publicar no hace nada en mi tablero.',
    supportOpened: 'Listo, abrimos tu pedido de ayuda. El equipo te responde por acá.',
    supportOpenedByEmail: 'Listo, abrimos tu pedido de ayuda. El equipo te responde por mail y en ShareOut.',
    pageNotFound: 'No encontré ese artefacto.',
    rendering: (pdf) => (pdf ? 'Armando el PDF…' : 'Armando la captura…'),
    sent: (pdf) => (pdf ? 'PDF enviado.' : 'Captura enviada.'),
    adminOnly: 'Este comando es solo para admins de la plataforma.',
    heard: (text) => `🎙️ “${text}”`,
  },
};
