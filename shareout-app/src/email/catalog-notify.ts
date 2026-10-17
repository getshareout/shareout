// Review and sharing notifications: guest comment codes, version approvals, the first
// open of a shared folder, new versions for followers, and a folder newly shared with an
// existing outside person. English templates join EMAILS in catalog.ts; the Spanish
// (voseo) builders join EMAILS_ES in catalog-es.ts. Only type imports from the catalog,
// so neither file needs this one first.
import type { BuiltEmail, EmailContext, EmailTemplate } from './catalog';
import { escapeHtml } from './layout';
import { colors, fonts, radius } from '../../packages/design-tokens/src/index';

export interface GuestCodeData { code: string; title: string }
export interface VersionApprovedData { approverName: string; title: string; versionNo: number | null; url: string }
export interface FolderFirstOpenData { viewerEmail: string; folderName: string; itemName: string; url: string }
export interface VersionPublishedData {
  title: string;
  url: string;
  publisherName: string;
  versions: Array<{ no: number; note: string | null }>;
}
export interface FolderSharedData { sharerName: string; folderName: string; workspaceName: string; url: string }
export interface SpaceGuestInviteData { sharerName: string; folderName: string; workspaceName: string; url: string }
export interface SpaceGuestCodeData { code: string; folderName: string; workspaceName: string }

const p = (s: string) => `<p style="margin:0 0 14px">${s}</p>`;
const strong = (s: string) => `<strong>${escapeHtml(s)}</strong>`;
const code = (c: string) =>
  `<div style="font-family:${fonts.mono};font-size:34px;font-weight:700;letter-spacing:8px;color:${colors.text};background:${colors.surface};border:1px solid ${colors.border};border-radius:${radius.sm};padding:18px;text-align:center">${escapeHtml(c)}</div>`;
const notes = (versions: VersionPublishedData['versions'], label: (n: number) => string) => {
  const rows = versions.filter((v) => v.note);
  if (!rows.length) return { html: '', text: '' };
  const html = `<blockquote style="margin:0;border-left:3px solid ${colors.borderStrong};padding:2px 0 2px 14px;color:${colors.textSecondary}">` +
    rows.map((v) => (rows.length > 1 ? `${escapeHtml(label(v.no))}: ` : '') + escapeHtml(v.note!)).join('<br>') + '</blockquote>';
  const text = rows.map((v) => (rows.length > 1 ? `${label(v.no)}: ` : '') + v.note).join('\n');
  return { html, text };
};
const latest = (versions: VersionPublishedData['versions']) => versions.reduce((m, v) => Math.max(m, v.no), 0);

export const NOTIFY_EMAILS = {
  guest_comment_code: {
    category: 'transactional',
    audiences: ['ANY', 'EXTERNAL'],
    trigger: 'POST /v1/data/{id}/comments/_guest/code — a guest asks for a code to comment without an account.',
    build: ({ code: c, title }: GuestCodeData) => ({
      subject: `${c} is your code to comment on ${title}`,
      preheader: 'Your code to comment as a guest (expires in 10 minutes).',
      heading: 'Your code to comment',
      bodyHtml: p(`Enter this code to comment on ${strong(title)} as a guest. It expires in 10 minutes.`) + code(c),
      footerNote: 'If you did not ask for it, you can ignore this email.',
      bodyText: `Your code to comment on "${title}" is ${c}. It expires in 10 minutes.\n\nIf you did not ask for it, you can ignore this email.`,
    }),
  } satisfies EmailTemplate<GuestCodeData>,

  version_approved: {
    category: 'product',
    audiences: ['ANY'],
    trigger: 'setApproval() — someone else approves a version of your artifact.',
    build: ({ approverName, title, versionNo, url }: VersionApprovedData) => {
      const v = versionNo ? `version ${versionNo}` : 'the live version';
      return {
        subject: `${approverName} approved ${v} of ${title}`,
        preheader: `${approverName} signed off on ${v}.`,
        heading: `${approverName} approved ${v}`,
        bodyHtml: p(`${strong(approverName)} signed off on ${v} of ${strong(title)}.`),
        cta: { label: 'Open the artifact', href: url },
        bodyText: `${approverName} signed off on ${v} of "${title}".`,
      };
    },
  } satisfies EmailTemplate<VersionApprovedData>,

  folder_first_open: {
    category: 'product',
    audiences: ['ANY'],
    trigger: 'recordShareeView() — an outside person opens something in a folder you shared (once per person per folder per day).',
    build: ({ viewerEmail, folderName, itemName, url }: FolderFirstOpenData) => ({
      subject: `${viewerEmail} opened ${folderName}`,
      preheader: `${viewerEmail} opened ${itemName}.`,
      heading: `${viewerEmail} opened your shared folder`,
      bodyHtml:
        p(`${strong(viewerEmail)} just opened ${strong(itemName)} in ${strong(folderName)}.`) +
        p('You hear about each person once a day, the first time they open something there.'),
      cta: { label: 'See who opened what', href: url },
      bodyText: `${viewerEmail} just opened "${itemName}" in "${folderName}".\n\nYou hear about each person once a day, the first time they open something there.`,
    }),
  } satisfies EmailTemplate<FolderFirstOpenData>,

  version_published: {
    category: 'product',
    audiences: ['ANY'],
    trigger: 'runVersionNoticeSweep() — new versions of an artifact you follow or collaborate on, once publishing settles.',
    build: ({ title, url, publisherName, versions }: VersionPublishedData) => {
      const n = latest(versions);
      const lead = versions.length > 1
        ? `${publisherName} published ${versions.length} new versions, up to version ${n}.`
        : `${publisherName} published version ${n}.`;
      const body = notes(versions, (no) => `Version ${no}`);
      return {
        subject: `${title} has a new version`,
        preheader: body.text.split('\n')[0] || lead,
        heading: `New version of ${title}`,
        bodyHtml: p(escapeHtml(lead)) + body.html,
        cta: { label: 'See what changed', href: url },
        footerNote: 'You get this because you follow or collaborate on this artifact.',
        bodyText: `${lead}${body.text ? `\n\n${body.text}` : ''}`,
      };
    },
  } satisfies EmailTemplate<VersionPublishedData>,

  folder_shared: {
    category: 'product',
    audiences: ['ANY', 'EXTERNAL'],
    trigger: 'insertGrant() — a folder is newly shared with an outside person who already has an account.',
    build: ({ sharerName, folderName, workspaceName, url }: FolderSharedData) => ({
      subject: `${sharerName} shared ${folderName} with you`,
      preheader: `Everything in ${folderName} is on your shared page.`,
      heading: `${folderName} is shared with you`,
      bodyHtml: p(`${strong(sharerName)} shared the folder ${strong(folderName)} from ${strong(workspaceName)} with you. Everything in it is on your shared page.`),
      cta: { label: 'Open the folder', href: url },
      bodyText: `${sharerName} shared the folder "${folderName}" from ${workspaceName} with you.`,
    }),
  } satisfies EmailTemplate<FolderSharedData>,

  space_guest_invite: {
    category: 'transactional',
    audiences: ['ANY', 'EXTERNAL'],
    trigger: 'POST /v1/workspaces/{ws}/share-person with guest: true — a folder is shared with someone as a guest (no account).',
    build: ({ sharerName, folderName, workspaceName, url }: SpaceGuestInviteData) => ({
      subject: `${sharerName} shared ${folderName} with you`,
      preheader: `Open ${folderName} without creating an account.`,
      heading: `${folderName} is shared with you`,
      bodyHtml:
        p(`${strong(sharerName)} from ${strong(workspaceName)} shared ${strong(folderName)} with you. Open it with the button below — no account or password needed.`) +
        p('The link signs you in on this browser. On another device, open the space and ask for a code by email.'),
      cta: { label: 'Open the space', href: url },
      footerNote: 'Only you should use this link. If you did not expect it, you can ignore this email.',
      bodyText: `${sharerName} from ${workspaceName} shared "${folderName}" with you. Open it here, no account needed:\n${url}\n\nOnly you should use this link.`,
    }),
  } satisfies EmailTemplate<SpaceGuestInviteData>,

  space_guest_code: {
    category: 'transactional',
    audiences: ['ANY', 'EXTERNAL'],
    trigger: 'POST /shared/guest/code — a guest asks for a code to open a space shared with them.',
    build: ({ code: c, folderName, workspaceName }: SpaceGuestCodeData) => ({
      subject: `${c} is your code to open ${folderName}`,
      preheader: 'Your code to open a shared space (expires in 10 minutes).',
      heading: 'Your code to open the space',
      bodyHtml: p(`Enter this code to open ${strong(folderName)} from ${strong(workspaceName)}. It expires in 10 minutes.`) + code(c),
      footerNote: 'If you did not ask for it, you can ignore this email.',
      bodyText: `Your code to open "${folderName}" from ${workspaceName} is ${c}. It expires in 10 minutes.\n\nIf you did not ask for it, you can ignore this email.`,
    }),
  } satisfies EmailTemplate<SpaceGuestCodeData>,
} as const;

type Builder = (data: any, ctx: EmailContext) => BuiltEmail;

export const NOTIFY_EMAILS_ES: Record<keyof typeof NOTIFY_EMAILS, Builder> = {
  guest_comment_code: ({ code: c, title }: GuestCodeData) => ({
    subject: `${c} es tu código para comentar en ${title}`,
    preheader: 'Tu código para comentar como invitado (vence en 10 minutos).',
    heading: 'Tu código para comentar',
    bodyHtml: p(`Ingresá este código para comentar en ${strong(title)} como invitado. Vence en 10 minutos.`) + code(c),
    footerNote: 'Si no lo pediste vos, podés ignorar este mail.',
    bodyText: `Tu código para comentar en "${title}" es ${c}. Vence en 10 minutos.\n\nSi no lo pediste vos, podés ignorar este mail.`,
  }),

  version_approved: ({ approverName, title, versionNo, url }: VersionApprovedData) => {
    const v = versionNo ? `la versión ${versionNo}` : 'la versión publicada';
    return {
      subject: `${approverName} aprobó ${v} de ${title}`,
      preheader: `${approverName} dio el visto bueno a ${v}.`,
      heading: `${approverName} aprobó ${v}`,
      bodyHtml: p(`${strong(approverName)} dio el visto bueno a ${v} de ${strong(title)}.`),
      cta: { label: 'Abrir el artefacto', href: url },
      bodyText: `${approverName} dio el visto bueno a ${v} de "${title}".`,
    };
  },

  folder_first_open: ({ viewerEmail, folderName, itemName, url }: FolderFirstOpenData) => ({
    subject: `${viewerEmail} abrió ${folderName}`,
    preheader: `${viewerEmail} abrió ${itemName}.`,
    heading: `${viewerEmail} abrió tu carpeta compartida`,
    bodyHtml:
      p(`${strong(viewerEmail)} acaba de abrir ${strong(itemName)} en ${strong(folderName)}.`) +
      p('Te avisamos una vez por día por persona, la primera vez que abre algo ahí.'),
    cta: { label: 'Ver quién abrió qué', href: url },
    bodyText: `${viewerEmail} acaba de abrir "${itemName}" en "${folderName}".\n\nTe avisamos una vez por día por persona, la primera vez que abre algo ahí.`,
  }),

  version_published: ({ title, url, publisherName, versions }: VersionPublishedData) => {
    const n = latest(versions);
    const lead = versions.length > 1
      ? `${publisherName} publicó ${versions.length} versiones nuevas, hasta la versión ${n}.`
      : `${publisherName} publicó la versión ${n}.`;
    const body = notes(versions, (no) => `Versión ${no}`);
    return {
      subject: `${title} tiene una versión nueva`,
      preheader: body.text.split('\n')[0] || lead,
      heading: `Nueva versión de ${title}`,
      bodyHtml: p(escapeHtml(lead)) + body.html,
      cta: { label: 'Ver qué cambió', href: url },
      footerNote: 'Te llega porque seguís este artefacto o colaborás en él.',
      bodyText: `${lead}${body.text ? `\n\n${body.text}` : ''}`,
    };
  },

  folder_shared: ({ sharerName, folderName, workspaceName, url }: FolderSharedData) => ({
    subject: `${sharerName} compartió ${folderName} con vos`,
    preheader: `Todo lo que tiene ${folderName} está en tu página de compartidos.`,
    heading: `Te compartieron ${folderName}`,
    bodyHtml: p(`${strong(sharerName)} compartió con vos la carpeta ${strong(folderName)} de ${strong(workspaceName)}. Todo lo que tiene está en tu página de compartidos.`),
    cta: { label: 'Abrir la carpeta', href: url },
    bodyText: `${sharerName} compartió con vos la carpeta "${folderName}" de ${workspaceName}.`,
  }),

  space_guest_invite: ({ sharerName, folderName, workspaceName, url }: SpaceGuestInviteData) => ({
    subject: `${sharerName} compartió ${folderName} con vos`,
    preheader: `Abrí ${folderName} sin crear una cuenta.`,
    heading: `Te compartieron ${folderName}`,
    bodyHtml:
      p(`${strong(sharerName)} de ${strong(workspaceName)} compartió ${strong(folderName)} con vos. Abrilo con el botón de abajo: no necesitás cuenta ni contraseña.`) +
      p('El enlace te deja entrar desde este navegador. En otro dispositivo, abrí el espacio y pedí un código por mail.'),
    cta: { label: 'Abrir el espacio', href: url },
    footerNote: 'Este enlace es solo para vos. Si no lo esperabas, podés ignorar este mail.',
    bodyText: `${sharerName} de ${workspaceName} compartió "${folderName}" con vos. Abrilo acá, sin cuenta:\n${url}\n\nEste enlace es solo para vos.`,
  }),

  space_guest_code: ({ code: c, folderName, workspaceName }: SpaceGuestCodeData) => ({
    subject: `${c} es tu código para abrir ${folderName}`,
    preheader: 'Tu código para abrir un espacio compartido (vence en 10 minutos).',
    heading: 'Tu código para abrir el espacio',
    bodyHtml: p(`Ingresá este código para abrir ${strong(folderName)} de ${strong(workspaceName)}. Vence en 10 minutos.`) + code(c),
    footerNote: 'Si no lo pediste vos, podés ignorar este mail.',
    bodyText: `Tu código para abrir "${folderName}" de ${workspaceName} es ${c}. Vence en 10 minutos.\n\nSi no lo pediste vos, podés ignorar este mail.`,
  }),
};
