import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import { requireWorkspaceRole } from '../../workspaces/roles';
import { isPlatformAdmin } from '../../superadmin/auth';
import { workspaceMarkup } from '../../data/ai-markup';
import { aiReport, aiReportCsv } from '../../workspaces/ai-report';
import { jsonWithApiErrors as json } from '../../http/api-error';

// GET /v1/workspaces/{id}/ai-report?month=YYYY-MM[&format=csv] — Admin → Billing → AI report: one month of
// AI at the workspace's price, broken down by category, kind, model (input/output tokens), automation,
// page, person and day (src/workspaces/ai-report.ts). Owners and admins; the instance operator also gets
// cost and markup. Agent tokens are refused.
export async function handleGetWorkspaceAiReport(request: Request, env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  if (user.service) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  const operator = await isPlatformAdmin(env, user.email, user.id);
  if (!operator) {
    const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
    if (forbidden) return forbidden;
  }
  const url = new URL(request.url);
  const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({ error: 'month must be YYYY-MM', code: 'INVALID_MONTH' }, 400);

  const report = await aiReport(env, workspaceId, month, (await workspaceMarkup(env, workspaceId)).bps, operator);
  if (url.searchParams.get('format') === 'csv') {
    return new Response(aiReportCsv(report), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ai-report-${month}.csv"` },
    });
  }
  return json({ ...report, operator });
}
