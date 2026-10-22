import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import { requireWorkspaceRole } from '../../workspaces/roles';
import { dailyUsageCsv, getDailyUsage, previousMonth, summarizeSpend, utcDay } from '../../workspaces/usage-ledger';
import { jsonWithApiErrors } from '../../http/api-error';

// GET /v1/workspaces/{id}/spend?month=YYYY-MM[&format=csv] — admin-only: what this
// workspace cost per day and per metric, with a month-end pace and last month's total.
export async function handleGetWorkspaceSpend(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;

  const url = new URL(request.url);
  const month = url.searchParams.get('month') || utcDay().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return jsonWithApiErrors({ error: 'month must be YYYY-MM', code: 'INVALID_MONTH' }, 400);
  }

  const daily = await getDailyUsage(env, month, workspaceId);
  if (url.searchParams.get('format') === 'csv') {
    return new Response(dailyUsageCsv(daily), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="usage-${month}.csv"`,
      },
    });
  }

  const prev = previousMonth(new Date(`${month}-01T00:00:00.000Z`));
  const prevRows = await getDailyUsage(env, prev, workspaceId);
  return jsonWithApiErrors({
    ...summarizeSpend(daily, month),
    previous: { month: prev, totalMicroUsd: prevRows.reduce((n, r) => n + r.costMicroUsd, 0) },
  });
}
