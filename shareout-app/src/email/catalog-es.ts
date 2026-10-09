// Spanish (rioplatense, voseo) copy for the member-facing lifecycle emails. Same
// data shapes as catalog.ts; a type with no entry here falls back to English.
// Voice: a friend from the team — warm, short, no jargon. "Página", never "artefacto".
import { EMAILS, p, codeBlock, inviteConnectNote, invitePersonalNote } from './catalog';
import type {
  BuiltEmail,
  EmailContext,
  EmailType,
  OtpData,
  InviteData,
  AddedToWorkspaceData,
  WorkspaceWelcomeData,
  InviteAcceptedData,
  MemberJoinedData,
  CommentData,
  ActionItemAssignedData,
  ActionItemResolvedData,
  ShareData,
  AccessRequestData,
  AccessApprovedData,
  AccessDeclinedData,
  PublishApprovalData,
  JobFailedData,
  SupportResolvedData,
  AssetDeliveryData,
} from './catalog';
import { escapeHtml } from './layout';
import { colors } from '../../packages/design-tokens/src/index';

const quote = (title: string, snippet: string) =>
  `<p style="margin:0 0 14px">En <strong>${escapeHtml(title)}</strong>:</p>` +
  `<blockquote style="margin:0;border-left:3px solid ${colors.borderStrong};padding:2px 0 2px 14px;color:${colors.textSecondary}">${escapeHtml(snippet)}</blockquote>`;

const longDate = (iso: string, utc = false) =>
  new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric', ...(utc ? { timeZone: 'UTC' } : {}) });

type Builder = (data: any, ctx: EmailContext) => BuiltEmail;

export const EMAILS_ES: Partial<Record<EmailType, Builder>> = {
  otp: ({ code }: OtpData) => ({
    subject: `${code} es tu código de ShareOut`,
    preheader: 'Tu código para entrar a ShareOut (vence en 10 minutos).',
    heading: 'Tu código para entrar',
    bodyHtml: p('Ingresá este código para terminar de entrar. Vence en 10 minutos.') + codeBlock(code),
    footerNote: 'Si no lo pediste vos, podés ignorar este mail.',
    bodyText: `Tu código para entrar a ShareOut es ${code}. Vence en 10 minutos.\n\nSi no lo pediste vos, podés ignorar este mail.`,
  }),

  welcome: (_d: Record<string, unknown>, { baseUrl }) => ({
    subject: 'Te damos la bienvenida a ShareOut: tu inicio está listo',
    preheader: 'Tu inicio y algunos ejemplos para arrancar ya están listos.',
    heading: 'Tu inicio está listo',
    bodyHtml:
      p('ShareOut convierte una idea en una página en vivo, con datos reales, para compartir con quien quieras. Sin servidores y sin configurar nada. Publicá un tablero, un formulario, una encuesta o una app entera con un clic.') +
      p('Te dejamos algunos ejemplos en tu inicio para que arranques: cada uno muestra una función y es tuyo para abrir, editar o borrar. Empezá por la primera de la lista: te muestra cómo publicar la tuya.'),
    cta: { label: 'Abrir tu inicio', href: `${baseUrl}/app` },
    footerNote: 'Te llega este mail porque recién creaste tu cuenta de ShareOut.',
    bodyText:
      'ShareOut convierte una idea en una página en vivo, con datos reales, para compartir. Te dejamos algunos ejemplos en tu inicio para que arranques; cada uno muestra una función y es tuyo para editar o borrar. Empezá por la primera de la lista: te muestra cómo publicar la tuya.',
  }),

  workspace_invite: ({ workspaceName, inviterName, claimCode, claimTtlDays, personalMessage }: InviteData, { baseUrl }) => {
    const joinUrl = `${baseUrl}/invite/${encodeURIComponent(claimCode)}`;
    const connectUrl = `${baseUrl}/home?view=connect`;
    const note = invitePersonalNote(`${inviterName} te dejó un mensaje:`, personalMessage);
    return {
      subject: `Te invitaron a ${workspaceName} en ShareOut`,
      preheader: `${inviterName} te invitó a ${workspaceName} en ShareOut.`,
      heading: `Sumate a ${workspaceName}`,
      bodyHtml:
        p(`${escapeHtml(inviterName)} te invitó a <strong>${escapeHtml(workspaceName)}</strong> en ShareOut, un lugar para armar y publicar páginas con datos reales. Abrí la invitación y ya estás adentro.`) +
        note.html +
        inviteConnectNote('Después de entrar, conectá Claude o ChatGPT en 2 minutos', connectUrl),
      cta: { label: `Entrar a ${workspaceName}`, href: joinUrl },
      footerNote: `La invitación se usa una sola vez y vence en ${claimTtlDays} días. Si no la esperabas, podés ignorar este mail.`,
      bodyText: `${inviterName} te invitó a ${workspaceName} en ShareOut.\n\n${note.text}Entrar a ${workspaceName}: ${joinUrl}\n\nDespués de entrar, conectá Claude o ChatGPT en 2 minutos: ${connectUrl}\n\nLa invitación se usa una sola vez y vence en ${claimTtlDays} días.`,
    };
  },

  added_to_workspace: ({ workspaceName, inviterName }: AddedToWorkspaceData, { baseUrl }) => ({
    subject: `Te sumaron a ${workspaceName} en ShareOut`,
    preheader: `${inviterName} te sumó a ${workspaceName}.`,
    heading: `Te sumaron a ${workspaceName}`,
    bodyHtml: p(`${escapeHtml(inviterName)} te sumó al espacio <strong>${escapeHtml(workspaceName)}</strong> en ShareOut. Ya podés armar y publicar páginas ahí.`),
    cta: { label: 'Abrir ShareOut', href: `${baseUrl}/home` },
    bodyText: `${inviterName} te sumó al espacio ${workspaceName} en ShareOut. Ya podés armar y publicar páginas ahí.`,
  }),

  workspace_welcome: ({ workspaceName, inviterName, role }: WorkspaceWelcomeData, { baseUrl }) => {
    const rol = /admin/i.test(role) ? 'admin' : 'miembro';
    return {
      subject: `Ya estás adentro: te damos la bienvenida a ${workspaceName}`,
      preheader: `Ya tenés acceso a ${workspaceName} en ShareOut.`,
      heading: `Te damos la bienvenida a ${workspaceName}`,
      bodyHtml: p(`${escapeHtml(inviterName)} te sumó a <strong>${escapeHtml(workspaceName)}</strong> como ${rol}. Todo lo que armó el equipo está ahí adentro: entrá y date una vuelta.`),
      cta: { label: `Abrir ${workspaceName}`, href: `${baseUrl}/home` },
      bodyText: `${inviterName} te sumó a ${workspaceName} como ${rol}. Abrí ${workspaceName}: ${baseUrl}/home`,
    };
  },

  invite_accepted: ({ memberName, workspaceName }: InviteAcceptedData, { baseUrl }) => ({
    subject: `${memberName} se sumó a ${workspaceName}`,
    preheader: `${memberName} aceptó tu invitación a ${workspaceName}.`,
    heading: `${memberName} se sumó a ${workspaceName}`,
    bodyHtml: p(`${escapeHtml(memberName)} aceptó tu invitación y ya está en <strong>${escapeHtml(workspaceName)}</strong>.`),
    cta: { label: 'Abrir el espacio', href: `${baseUrl}/home` },
    bodyText: `${memberName} aceptó tu invitación y ya está en ${workspaceName}. Abrir el espacio: ${baseUrl}/home`,
  }),

  member_joined: ({ memberName, workspaceName }: MemberJoinedData, { baseUrl }) => ({
    subject: `${memberName} se sumó a ${workspaceName}`,
    preheader: `${memberName} ahora es parte de ${workspaceName}.`,
    heading: `${memberName} se sumó a ${workspaceName}`,
    bodyHtml: p(`<strong>${escapeHtml(memberName)}</strong> ahora es parte de tu espacio <strong>${escapeHtml(workspaceName)}</strong>. Ya puede armar y publicar páginas ahí.`),
    cta: { label: 'Abrir el espacio', href: `${baseUrl}/home` },
    bodyText: `${memberName} ahora es parte de tu espacio ${workspaceName}.`,
  }),

  comment_notify: ({ fromName, verb, title, snippet, url, reason }: CommentData) => {
    const accion = (reason ?? (/replied/.test(verb) ? 'reply' : 'mention')) === 'reply' ? 'respondió tu comentario' : 'te mencionó en un comentario';
    return {
      subject: `${fromName} ${accion} en ${title}`,
      preheader: `${fromName}: ${snippet}`,
      heading: `${fromName} ${accion}`,
      bodyHtml: quote(title, snippet),
      cta: { label: 'Ver la conversación', href: url },
      bodyText: `${fromName} ${accion} en "${title}":\n\n"${snippet}"`,
    };
  },

  action_item_assigned: ({ fromName, title, snippet, url, dueStr, dueAt }: ActionItemAssignedData) => {
    const due = dueAt ? longDate(dueAt, true) : dueStr;
    return {
      subject: `${fromName} te asignó una tarea en ${title}`,
      preheader: `${fromName}: ${snippet}`,
      heading: `${fromName} te asignó una tarea`,
      bodyHtml: quote(title, snippet) + (due ? `<p style="margin:14px 0 0;color:${colors.textSecondary}">Para el ${escapeHtml(due)}</p>` : ''),
      cta: { label: 'Ver la tarea', href: url },
      bodyText: `${fromName} te asignó una tarea en "${title}":\n\n"${snippet}"${due ? `\n\nPara el ${due}` : ''}`,
    };
  },

  action_item_resolved: ({ fromName, title, snippet, url }: ActionItemResolvedData) => ({
    subject: `${fromName} terminó la tarea que asignaste en ${title}`,
    preheader: `${fromName}: ${snippet}`,
    heading: `${fromName} terminó tu tarea`,
    bodyHtml: quote(title, snippet),
    cta: { label: 'Revisar', href: url },
    bodyText: `${fromName} terminó la tarea que asignaste en "${title}":\n\n"${snippet}"`,
  }),

  artifact_share: (d: ShareData) => {
    const intro = d.sharerName ? `${d.sharerName} compartió una página con vos.` : 'Compartieron una página con vos.';
    const desc = d.artifactDescription?.trim();
    const msg = d.customMessage?.trim();
    const role =
      d.role === 'editor' ? 'Te sumaron como editor: abrila para empezar a editarla en equipo.'
      : d.role === 'viewer' ? 'Ya tenés acceso para ver esta página.'
      : '';
    return {
      subject: d.sharerName ? `${d.sharerName} compartió: ${d.artifactName}` : `Compartieron con vos: ${d.artifactName}`,
      preheader: desc || intro,
      heading: d.artifactName,
      bodyHtml:
        `<p style="margin:0 0 16px">${escapeHtml(intro)}</p>` +
        `<img src="${escapeHtml(d.thumbnailUrl)}" width="496" alt="Vista previa de ${escapeHtml(d.artifactName)}" style="display:block;width:100%;height:auto;border-radius:12px;border:1px solid ${colors.border};margin:0 0 4px" />` +
        (desc ? `<p style="margin:14px 0 0;color:${colors.textSecondary}">${escapeHtml(desc)}</p>` : '') +
        (msg ? `<div style="margin:16px 0 0;background:${colors.surface};border-left:3px solid ${colors.borderStrong};border-radius:8px;padding:12px 14px;color:${colors.textSecondary}">${escapeHtml(msg)}</div>` : '') +
        (role ? `<p style="margin:16px 0 0;color:${colors.textSecondary}">${escapeHtml(role)}</p>` : ''),
      cta: { label: 'Abrir la página', href: d.viewUrl },
      bodyText: [intro, '', d.artifactName, desc || '', msg ? `\n"${msg}"` : '', role ? `\n${role}` : ''].filter((x) => x !== '').join('\n'),
    };
  },

  access_request: ({ requesterEmail, pageName, url }: AccessRequestData) => ({
    subject: `${requesterEmail} pidió acceso a ${pageName}`,
    preheader: `${requesterEmail} quiere ver ${pageName}.`,
    heading: 'Alguien quiere ver tu página',
    bodyHtml:
      p(`<strong>${escapeHtml(requesterEmail)}</strong> pidió acceso a tu página <strong>${escapeHtml(pageName)}</strong>.`) +
      p('Abrí la página para aprobar o rechazar el pedido.'),
    cta: { label: 'Ver el pedido', href: url },
    bodyText: `${requesterEmail} pidió acceso a tu página "${pageName}". Abrí la página para aprobar o rechazar el pedido: ${url}`,
  }),

  access_approved: ({ pageName, url }: AccessApprovedData) => ({
    subject: `Ya tenés acceso: ${pageName}`,
    preheader: `Ya podés ver ${pageName}.`,
    heading: `Ya tenés acceso a ${pageName}`,
    bodyHtml: p(`Aprobaron tu pedido: ya podés abrir <strong>${escapeHtml(pageName)}</strong>.`),
    cta: { label: 'Abrir la página', href: url },
    bodyText: `Ya tenés acceso a ${pageName}. Abrir la página: ${url}`,
  }),

  access_declined: ({ pageName }: AccessDeclinedData) => ({
    subject: 'Sobre tu pedido de acceso',
    preheader: `Novedades sobre tu pedido para ver ${pageName}.`,
    heading: 'Sobre tu pedido',
    bodyHtml: p(`Esta vez no te dieron acceso a <strong>${escapeHtml(pageName)}</strong>. Si lo necesitás, escribile directamente a quien la armó.`),
    bodyText: `Esta vez no te dieron acceso a ${pageName}. Si lo necesitás, escribile directamente a quien la armó.`,
  }),

  publish_approval: ({ kind }: PublishApprovalData, { baseUrl }) => {
    const cta = { label: kind === 'request' ? 'Ver el pedido' : 'Abrir ShareOut', href: `${baseUrl}/home` };
    if (kind === 'request') {
      const body = 'Alguien de tu equipo quiere publicar una página para cualquiera con el link y te eligió para aprobarla.';
      return { subject: 'Alguien de tu equipo necesita tu aprobación para publicar una página', preheader: 'Te eligieron para aprobar una página pública.', heading: 'Necesitamos tu aprobación', bodyHtml: p(body), cta, bodyText: body };
    }
    if (kind === 'approved') {
      const body = 'Tu equipo aprobó la publicación de tu página. Ya se está publicando; solo falta el control de seguridad automático.';
      return { subject: 'Aprobaron la publicación de tu página', preheader: 'Aprobaron tu página', heading: 'Aprobaron tu página', bodyHtml: p(body), cta, bodyText: body };
    }
    const body = 'Rechazaron tu pedido para publicar la página para cualquiera con el link. Sigue visible para tu espacio.';
    return { subject: 'Rechazaron tu pedido de publicación', preheader: 'Rechazaron tu pedido de publicación', heading: 'Rechazaron tu pedido de publicación', bodyHtml: p(body), cta, bodyText: body };
  },

  job_failed: ({ jobName, error }: JobFailedData, { baseUrl }) => {
    const next = 'Va a volver a intentar en el próximo horario programado. Abrí Programaciones para arreglarla o correrla ahora.';
    return {
      subject: `Falló tu programación "${jobName}"`,
      preheader: error,
      heading: 'Falló una programación',
      bodyHtml: p(`<strong>${escapeHtml(jobName)}</strong> falló en la última corrida:`) + p(escapeHtml(error)) + p(next),
      cta: { label: 'Abrir Programaciones', href: `${baseUrl}/home#l/schedules` },
      bodyText: `${jobName} falló en la última corrida:\n\n${error}\n\n${next}`,
    };
  },

  support_resolved: ({ subject }: SupportResolvedData) => ({
    subject: `Resuelto: ${subject}`,
    preheader: 'Marcamos tu consulta como resuelta.',
    heading: 'Consulta resuelta',
    bodyHtml: p('Marcamos tu consulta como resuelta. Si algo no quedó bien, respondé este mail y la retomamos.'),
    footerNote: 'Respondé este mail para retomar la conversación.',
    bodyText: 'Marcamos tu consulta como resuelta. Si algo no quedó bien, respondé este mail y la retomamos.',
  }),

  asset_delivery: ({ collectionName, downloadUrl, fileCount, senderName, expiresAt }: AssetDeliveryData) => {
    const who = senderName?.trim();
    const n = `${fileCount} ${fileCount === 1 ? 'archivo' : 'archivos'}`;
    const until = expiresAt ? longDate(expiresAt) : '';
    return {
      subject: who ? `${who} te mandó archivos: ${collectionName}` : `Archivos para vos: ${collectionName}`,
      preheader: `${n} para descargar.`,
      heading: collectionName,
      bodyHtml:
        p(`${who ? `<strong>${escapeHtml(who)}</strong> te mandó ` : 'Tenés '}${n} para descargar.`) +
        (until ? `<p style="margin:14px 0 0;color:${colors.textSecondary};font-size:13px">El link está disponible hasta el ${escapeHtml(until)}.</p>` : ''),
      cta: { label: 'Descargar archivos', href: downloadUrl },
      bodyText: `${who ? `${who} te mandó ` : 'Tenés '}${n} para descargar: ${downloadUrl}${until ? `\n\nDisponible hasta el ${until}.` : ''}`,
    };
  },
};

/** Build an email in the recipient's language; English when there's no Spanish copy. */
export function buildEmail(type: EmailType, data: Record<string, unknown>, ctx: EmailContext): BuiltEmail | null {
  const es = ctx.locale === 'es' ? EMAILS_ES[type] : undefined;
  if (es) return es(data, ctx);
  const tmpl = EMAILS[type] as { build?: Builder };
  return tmpl.build ? tmpl.build(data, ctx) : null;
}
