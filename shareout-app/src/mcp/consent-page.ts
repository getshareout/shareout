/**
 * The "allow this app?" page an AI app (Claude, ChatGPT…) sends a person to when they
 * connect ShareOut. Plain words, English or rioplatense Spanish by Accept-Language.
 */
import { renderHtmlPage } from '../design-system/shell';
import { authPageStyles } from '../design-system/pages/auth.css';
import { escapeHtml } from '../html/utils';

export type ConsentLang = 'en' | 'es';

export function pickLang(request: Request): ConsentLang {
  const first = (request.headers.get('Accept-Language') || '').split(',')[0]?.trim().toLowerCase() || '';
  return first.startsWith('es') ? 'es' : 'en';
}

const COPY = {
  en: {
    title: (app: string) => `Connect ${app} to ShareOut`,
    ask: (app: string) => `${app} wants to publish pages to your ShareOut account.`,
    can: 'It will be able to see your workspaces and pages, publish new pages, and update the ones you already have.',
    signedIn: 'Signed in as',
    back: 'Afterwards you go back to',
    loopback: 'This app runs on your own computer. Only allow it if you just started it yourself.',
    allow: 'Allow',
    deny: 'Cancel',
    errorTitle: 'This link doesn\'t work',
    errorBack: 'Go to ShareOut',
    errors: {
      client: 'The app that sent you here is not registered with ShareOut. Remove the connector in that app and add it again.',
      redirect: 'The app that sent you here asked to be sent back to an address it did not register. Nothing was shared.',
      expired: 'This page expired. Go back to the app and try connecting again.',
    },
  },
  es: {
    title: (app: string) => `Conectar ${app} con ShareOut`,
    ask: (app: string) => `${app} quiere publicar páginas en tu cuenta de ShareOut.`,
    can: 'Va a poder ver tus espacios de trabajo y tus páginas, publicar páginas nuevas y actualizar las que ya tenés.',
    signedIn: 'Entraste como',
    back: 'Después te llevamos de vuelta a',
    loopback: 'Esta app corre en tu propia computadora. Permitila solo si la acabás de abrir vos.',
    allow: 'Permitir',
    deny: 'Cancelar',
    errorTitle: 'Este enlace no funciona',
    errorBack: 'Ir a ShareOut',
    errors: {
      client: 'La app que te mandó acá no está registrada en ShareOut. Sacá el conector en esa app y volvé a agregarlo.',
      redirect: 'La app que te mandó acá pidió volver a una dirección que no registró. No se compartió nada.',
      expired: 'Esta página venció. Volvé a la app y probá conectar de nuevo.',
    },
  },
} as const;

// The page grants access, so it must never render inside someone else's frame.
const NO_FRAME = { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" };

export interface ConsentPageInput {
  lang: ConsentLang;
  clientName: string;
  redirectHost: string;
  isLoopback: boolean;
  email: string;
  /** Every authorize parameter plus the CSRF token, echoed back as hidden fields. */
  fields: Record<string, string>;
}

export function consentPage(input: ConsentPageInput): Response {
  const t = COPY[input.lang];
  const app = escapeHtml(input.clientName);
  const hidden = Object.entries(input.fields)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join('\n');
  return renderHtmlPage({
    title: `${t.title(input.clientName)} - ShareOut`,
    pageStyles: authPageStyles,
    lang: input.lang,
    noSocial: true,
    extraHeaders: { ...NO_FRAME, 'Cache-Control': 'no-store' },
    body: `
    <div class="card">
      <div class="icon icon-primary">🔗</div>
      <h1>${escapeHtml(t.title(input.clientName))}</h1>
      <p>${escapeHtml(t.ask(input.clientName)).replace(app, `<strong>${app}</strong>`)}</p>
      <p class="auth-help">${escapeHtml(t.can)}</p>
      <p class="auth-help">${escapeHtml(t.signedIn)} <span class="email">${escapeHtml(input.email)}</span></p>
      <p class="auth-help">${escapeHtml(t.back)} <strong>${escapeHtml(input.redirectHost)}</strong></p>
      ${input.isLoopback ? `<p class="auth-help auth-help--warning">${escapeHtml(t.loopback)}</p>` : ''}
      <form method="POST" action="/oauth/authorize" class="actions-stack">
        ${hidden}
        <button type="submit" name="decision" value="allow" class="so-c-btn so-c-btn--primary so-c-btn--block">${escapeHtml(t.allow)}</button>
        <button type="submit" name="decision" value="deny" class="so-c-btn so-c-btn--secondary so-c-btn--block">${escapeHtml(t.deny)}</button>
      </form>
      <div class="footer">Powered by <a href="/">ShareOut</a></div>
    </div>`,
  });
}

/** Shown when the request can't be trusted enough to redirect anywhere (bad client or redirect URI). */
export type OAuthPageError = keyof (typeof COPY)['en']['errors'];

export function oauthErrorPage(lang: ConsentLang, reason: OAuthPageError): Response {
  const t = COPY[lang];
  const message = t.errors[reason];
  return renderHtmlPage({
    title: `${t.errorTitle} - ShareOut`,
    pageStyles: authPageStyles,
    lang,
    noSocial: true,
    status: 400,
    extraHeaders: { ...NO_FRAME, 'Cache-Control': 'no-store' },
    body: `
    <div class="card">
      <div class="icon icon-error">!</div>
      <h1 class="error">${escapeHtml(t.errorTitle)}</h1>
      <p>${escapeHtml(message)}</p>
      <a href="/home" class="so-c-btn so-c-btn--primary so-c-btn--block">${escapeHtml(t.errorBack)}</a>
    </div>`,
  });
}
