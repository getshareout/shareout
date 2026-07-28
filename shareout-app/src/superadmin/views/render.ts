/**
 * View dispatcher: fetches only the data each admin view needs, then renders HTML.
 */

import type { Env } from '../../types';
import { recentAuditLog } from '../../audit';
import {
  getCostMetrics,
  getFunnelMetrics,
  getOpsMetrics,
  getStorageMetrics,
  getWorkspaceCosts,
} from '../insights';
import { getPlatformMetrics, getAiUsageMetrics } from '../metrics';
import { listModerationQueue } from '../artifacts-admin';
import { listUsers } from '../users';
import { renderFeaturesBody } from '../features-view';
import {
  getHourlySeries,
  getWindowSummary,
  getRecentErrors,
  resolveSuperadminTelegramChatIds,
} from '../../observability';
import type { RangeDef } from './config';
import { auditBody, moderationBody, usersBody } from './bodies/admin-lists';
import { healthBody, opsBody } from './bodies/health-ops';
import { artifactsBody, funnelBody, tokensBody, trafficBody } from './bodies/metrics';
import { overviewBody, costsBody, workspaceCostsBody } from './bodies/overview-costs';
import { supportBody } from './bodies/support';
import { storageBody } from './bodies/storage';
import { instanceBody } from './bodies/instance';
import { buildInstanceConfig } from '../instance-config';
import { listAll } from '../../support/store';
import { listLatestStorageSnapshots, listOverCapSnapshots } from '../../storage-snapshots';

/** Render one admin view's inner HTML (no shell). */
export async function renderView(env: Env, view: string, range: RangeDef): Promise<string> {
  const days = range.days;
  switch (view) {
    case 'workspace-costs':
      return workspaceCostsBody(await getWorkspaceCosts(env, range.sinceExpr, days));
    case 'costs':
      return costsBody(await getCostMetrics(env, days));
    case 'artifacts': {
      const [m, storage] = await Promise.all([getPlatformMetrics(env, days), getStorageMetrics(env)]);
      return artifactsBody(m, storage);
    }
    case 'traffic':
      return trafficBody(await getPlatformMetrics(env, days));
    case 'funnel':
      return funnelBody(await getFunnelMetrics(env, days));
    case 'tokens': {
      const [m, ai] = await Promise.all([getPlatformMetrics(env, days), getAiUsageMetrics(env, days)]);
      return tokensBody(m, ai);
    }
    case 'health': {
      const [w24, w1, series, errors, alertChats] = await Promise.all([
        getWindowSummary(env, 24),
        getWindowSummary(env, 1),
        getHourlySeries(env, 48),
        getRecentErrors(env, 50),
        resolveSuperadminTelegramChatIds(env),
      ]);
      return healthBody(w24, w1, series, errors, alertChats);
    }
    case 'operations':
      return opsBody(await getOpsMetrics(env));
    case 'users':
      return usersBody(await listUsers(env, '', 50, 0));
    case 'moderation':
      return moderationBody(await listModerationQueue(env));
    case 'support':
      return supportBody(await listAll(env, { limit: 200 }));
    case 'instance':
      return instanceBody(await buildInstanceConfig(env));
    case 'features':
      return renderFeaturesBody(env);
    case 'audit':
      return auditBody(await recentAuditLog(env, 200));
    case 'storage': {
      const [top, over] = await Promise.all([
        listLatestStorageSnapshots(env, 50),
        listOverCapSnapshots(env, 50),
      ]);
      return storageBody(top, over);
    }
    case 'overview':
    default: {
      const [m, cost, funnel] = await Promise.all([
        getPlatformMetrics(env, days),
        getCostMetrics(env, days),
        getFunnelMetrics(env, days),
      ]);
      return overviewBody(m, cost, funnel);
    }
  }
}
