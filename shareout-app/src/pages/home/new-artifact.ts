/**
 * POST /v1/home/new — the Studio "New" menu's no-AI path: a blank document or a
 * document from a simple template, created privately for the signed-in person and
 * opened straight into the editor. Inside a workspace the caller must be an internal
 * member (same rule as /v1/publish); the daily publish count and storage cap apply.
 */
import type { Env } from '../../types';
import { escapeHtml } from '../../html/utils';
import { colors, fonts, radius } from '../../../packages/design-tokens/src/index';
import { checkRateLimit, incrementRateLimit } from '../../api-auth';
import { checkStorageQuota } from '../../quota';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { publishGeneratedHtml } from '../../publish/publish-generated-html';
import { rateLimitExceededResponse, storageLimitMessage } from '../../publish/limits';
import { generateSlug } from '../../validation';
import { hostWorkspaceId } from './host';

type Lang = 'en' | 'es';
interface DocTemplate { title: string; intro: string; sections: string[] }

export const NEW_DOC_TEMPLATES: Record<string, Record<Lang, DocTemplate>> = {
  blank: {
    en: { title: 'Untitled document', intro: 'Start writing here.', sections: [] },
    es: { title: 'Documento sin título', intro: 'Empezá a escribir acá.', sections: [] },
  },
  report: {
    en: { title: 'Report', intro: 'What this report covers, in one or two lines.', sections: ['Summary', 'Details', 'Next steps'] },
    es: { title: 'Informe', intro: 'De qué trata este informe, en una o dos líneas.', sections: ['Resumen', 'Detalle', 'Próximos pasos'] },
  },
  meeting: {
    en: { title: 'Meeting notes', intro: 'Date and who attended.', sections: ['Topics', 'Decisions', 'Action items'] },
    es: { title: 'Minuta de reunión', intro: 'Fecha y quiénes participaron.', sections: ['Temas', 'Decisiones', 'Tareas'] },
  },
  proposal: {
    en: { title: 'Proposal', intro: 'Who this is for and what it solves.', sections: ['Context', 'What we propose', 'Cost and timeline', 'Next steps'] },
    es: { title: 'Propuesta', intro: 'Para quién es y qué resuelve.', sections: ['Contexto', 'Qué proponemos', 'Costos y plazos', 'Próximos pasos'] },
  },
};

/** A plain, editable document: headings + paragraphs the in-Studio editor can change. */
export function buildDocHtml(tpl: DocTemplate, lang: Lang): string {
  const sections = tpl.sections
    .map((h) => `<h2>${escapeHtml(h)}</h2>\n<p>${lang === 'es' ? 'Escribí acá.' : 'Write here.'}</p>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(tpl.title)}</title>
<style>
body{margin:0;background:${colors.bg};color:${colors.text};font-family:${fonts.body};line-height:1.6}
main{max-width:720px;margin:0 auto;padding:48px 24px 80px}
h1{font-family:${fonts.display};font-size:32px;line-height:1.2;margin:0 0 12px}
h2{font-size:20px;margin:32px 0 8px}
p{margin:0 0 12px;color:${colors.textSecondary}}
a{color:${colors.primary}}
img{max-width:100%;border-radius:${radius.md}}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(tpl.title)}</h1>
<p>${escapeHtml(tpl.intro)}</p>
${sections}
</main>
</body>
</html>`;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function handleHomeNewArtifactApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { template?: unknown; lang?: unknown };
  const key = typeof body.template === 'string' && body.template ? body.template : 'blank';
  const tpls = NEW_DOC_TEMPLATES[key];
  if (!tpls) return json({ error: 'Unknown template', code: 'VALIDATION_ERROR', param: 'template', allowed: Object.keys(NEW_DOC_TEMPLATES) }, 400);
  const lang: Lang = body.lang === 'es' ? 'es' : 'en';

  const workspaceId = (await hostWorkspaceId(request, env)) || new URL(request.url).searchParams.get('workspace')?.trim() || null;
  if (workspaceId && !(await getInternalWorkspaceRole(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const rate = await checkRateLimit(env, user.id, 'publish', user.email);
  if (!rate.allowed) return rateLimitExceededResponse(rate.reset);

  const tpl = tpls[lang];
  const html = buildDocHtml(tpl, lang);
  const quota = await checkStorageQuota(env, user.id, [{ path: 'index.html', content: html, mime: 'text/html' }]);
  if (!quota.allowed) return json({ error: storageLimitMessage(quota), code: 'STORAGE_LIMIT_EXCEEDED' }, 413);

  const base = generateSlug(tpl.title.normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const slug = `${base}-${crypto.randomUUID().slice(0, 6)}`;
  const published = await publishGeneratedHtml(env, { id: user.id, email: user.email || '' }, {
    name: tpl.title, slug, html, workspaceId, visibility: 'private',
  });
  await incrementRateLimit(env, user.id, 'publish', user.email);
  return json({ ok: true, artifactId: published.artifact.id, slug: published.deployment.slug, name: tpl.title });
}
