import type { Env } from './types';
import { validateAdminSession } from './api-auth';
import { getSessionUser } from './auth';
import { getAnalytics, type AnalyticsSummary } from './analytics';
import { renderHtmlPage } from './design-system/shell';
import { adminPageStyles } from './design-system/pages/admin.css';
import { authPageStyles } from './design-system/pages/auth.css';
import { escapeHtml } from './html/utils';

interface ArtifactDetails {
  id: string;
  name: string;
  slug: string;
  visibility: string;
  created_at: string;
  owner_id: string;
}

interface VersionInfo {
  id: string;
  version_no: number;
  entrypoint: string;
  created_at: string;
  is_deployed: boolean;
}

interface AdminCookiePayload {
  artifactId: string;
  userId: string;
  exp: number;
}

const ADMIN_COOKIE_NAME = 'shareout_admin';
const ADMIN_COOKIE_EXPIRY = 60 * 60 * 24; // 24 hours

export async function handleAdminPage(
  request: Request,
  env: Env,
  slug: string
): Promise<Response> {
  const url = new URL(request.url);
  const sessionToken = url.searchParams.get('session');

  const deployment = await env.DB.prepare(`
    SELECT a.id, a.name, a.visibility, a.created_at, a.owner_id, d.slug
    FROM deployments d
    JOIN artifacts a ON a.id = d.artifact_id
    WHERE d.slug = ? AND d.channel = 'production'
  `).bind(slug).first<ArtifactDetails>();

  if (!deployment) {
    return notFoundPage();
  }

  let userId: string | null = null;
  let isAuthorized = false;

  if (sessionToken) {
    const session = await validateAdminSession(env, sessionToken);
    if (session && session.artifactId === deployment.id) {
      userId = session.userId;
      isAuthorized = true;

      const redirectUrl = new URL(request.url);
      redirectUrl.searchParams.delete('session');

      return new Response(null, {
        status: 302,
        headers: {
          'Location': redirectUrl.toString(),
          'Set-Cookie': `${ADMIN_COOKIE_NAME}=${await createAdminCookie(deployment.id, userId, env)}; Path=/a/${slug}/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_COOKIE_EXPIRY}`,
        },
      });
    }
  }

  if (!isAuthorized) {
    const adminCookie = getCookie(request, ADMIN_COOKIE_NAME);
    const cookiePayload = adminCookie
      ? await verifyAdminCookie(adminCookie, deployment.id, env)
      : null;
    if (cookiePayload) {
      const authorizedUser = await isAdminUserAuthorized(env, deployment, cookiePayload.userId);
      if (authorizedUser) {
        userId = cookiePayload.userId;
        isAuthorized = true;
      }
    }
  }

  if (!isAuthorized) {
    const sessionUser = await getSessionUser(request, env);
    if (sessionUser) {
      const isOwner = await env.DB.prepare(
        'SELECT 1 FROM users WHERE id = ? AND email = ?'
      ).bind(deployment.owner_id, sessionUser.email).first();

      if (isOwner) {
        userId = deployment.owner_id;
        isAuthorized = true;
      } else {
        const collab = await env.DB.prepare(
          'SELECT role FROM collaborators WHERE artifact_id = ? AND email = ?'
        ).bind(deployment.id, sessionUser.email).first<{ role: string }>();

        if (collab && collab.role !== 'viewer') {
          const user = await env.DB.prepare(
            'SELECT id FROM users WHERE email = ?'
          ).bind(sessionUser.email).first<{ id: string }>();
          if (user) {
            userId = user.id;
            isAuthorized = true;
          }
        }
      }
    }
  }

  if (!isAuthorized) {
    return unauthorizedPage(slug, deployment.name);
  }

  const [versions, analytics] = await Promise.all([
    getVersions(env, deployment.id),
    getAnalytics(env, deployment.id, 7),
  ]);

  return renderAdminPage(env, deployment, versions, analytics);
}

async function isAdminUserAuthorized(
  env: Env,
  deployment: ArtifactDetails,
  userId: string
): Promise<boolean> {
  if (userId === deployment.owner_id) return true;

  const user = await env.DB.prepare(
    'SELECT email FROM users WHERE id = ?'
  ).bind(userId).first<{ email: string }>();
  if (!user?.email) return false;

  const collab = await env.DB.prepare(
    'SELECT role FROM collaborators WHERE artifact_id = ? AND email = ?'
  ).bind(deployment.id, user.email).first<{ role: string }>();

  return !!collab && collab.role !== 'viewer';
}

async function createAdminCookie(
  artifactId: string,
  userId: string,
  env: Env
): Promise<string> {
  const payload: AdminCookiePayload = {
    artifactId,
    userId,
    exp: Math.floor(Date.now() / 1000) + ADMIN_COOKIE_EXPIRY,
  };
  const data = btoa(JSON.stringify(payload));
  const signature = await signAdminCookie(data, env);
  return `${data}.${signature}`;
}

async function verifyAdminCookie(
  token: string,
  artifactId: string,
  env: Env
): Promise<AdminCookiePayload | null> {
  try {
    const [data, signature] = token.split('.');
    if (!data || !signature) return null;
    if (!await verifyAdminCookieSignature(data, signature, env)) return null;

    const payload = JSON.parse(atob(data)) as AdminCookiePayload;
    if (payload.artifactId !== artifactId) return null;
    if (!payload.userId || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

async function signAdminCookie(data: string, env: Env): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function verifyAdminCookieSignature(
  data: string,
  signature: string,
  env: Env
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
  return crypto.subtle.verify('HMAC', key, signatureBytes, new TextEncoder().encode(data));
}

async function getVersions(env: Env, artifactId: string): Promise<VersionInfo[]> {
  const currentDeployment = await env.DB.prepare(`
    SELECT version_id FROM deployments
    WHERE artifact_id = ? AND channel = 'production'
  `).bind(artifactId).first<{ version_id: string }>();

  const versions = await env.DB.prepare(`
    SELECT id, version_no, entrypoint, created_at
    FROM versions
    WHERE artifact_id = ?
    ORDER BY version_no DESC
    LIMIT 20
  `).bind(artifactId).all<{ id: string; version_no: number; entrypoint: string; created_at: string }>();

  return (versions.results || []).map(v => ({
    ...v,
    is_deployed: v.id === currentDeployment?.version_id,
  }));
}

function getCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get('Cookie');
  if (!cookies) return null;
  const match = cookies.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

function renderAdminPage(
  env: Env,
  artifact: ArtifactDetails,
  versions: VersionInfo[],
  analytics: AnalyticsSummary
): Response {
  const baseUrl = env.SHAREOUT_BASE_URL.replace(/\/$/, '');

  return renderHtmlPage({
    title: `Admin - ${escapeHtml(artifact.name)}`,
    pageStyles: adminPageStyles,
    body: `
  <header class="header">
    <div class="header-left">
      <h1>${escapeHtml(artifact.name)}</h1>
      <span class="badge badge-${artifact.visibility}">${artifact.visibility === 'public' ? 'Public' : 'Private'}</span>
    </div>
    <a href="${baseUrl}/a/${escapeHtml(artifact.slug)}/" class="so-c-btn so-c-btn--primary">View Page</a>
  </header>

  <div class="container">
    <div class="grid">
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Analytics (Last 7 Days)</h2>
        </div>
        <div class="stat-grid">
          <div class="stat">
            <div class="stat-value">${analytics.totalViews.toLocaleString()}</div>
            <div class="stat-label">Total Views</div>
          </div>
          <div class="stat">
            <div class="stat-value">${analytics.uniqueVisitors.toLocaleString()}</div>
            <div class="stat-label">Unique Visitors</div>
          </div>
          <div class="stat">
            <div class="stat-value">${analytics.dailyStats.length > 0 ? Math.round(analytics.totalViews / analytics.dailyStats.length) : 0}</div>
            <div class="stat-label">Avg Daily Views</div>
          </div>
        </div>
        ${renderChart(analytics.dailyStats)}
      </div>

      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Versions</h2>
        </div>
        ${renderVersionList(versions, artifact.slug, baseUrl)}
      </div>

      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Top Referrers</h2>
        </div>
        ${renderTopList(analytics.topReferrers)}
      </div>

      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Top Countries</h2>
        </div>
        ${renderTopList(analytics.topCountries, true)}
      </div>

      <div class="card card-full">
        <div class="card-header">
          <h2 class="card-title">Shared With</h2>
        </div>
        ${renderViewerTracking(analytics.viewerTracking)}
      </div>
    </div>
  </div>`,
  });
}

function renderChart(dailyStats: AnalyticsSummary['dailyStats']): string {
  if (dailyStats.length === 0) {
    return `<div class="empty">
      <p class="empty-text">Views will appear here once people visit.</p>
    </div>`;
  }

  const sorted = [...dailyStats].sort((a, b) => a.date.localeCompare(b.date));
  const maxViews = Math.max(...sorted.map(d => d.views), 1);

  const bars = sorted.map(day => {
    const height = Math.max((day.views / maxViews) * 100, 2);
    const label = new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' });
    return `<div class="chart-bar" style="height: ${height}%" data-value="${day.views} views" title="${day.date}: ${day.views} views"></div>`;
  }).join('');

  const labels = sorted.map(day => {
    const label = new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' });
    return `<div class="chart-label">${label}</div>`;
  }).join('');

  return `<div class="chart">${bars}</div><div class="chart-labels">${labels}</div>`;
}

function renderVersionList(versions: VersionInfo[], slug: string, baseUrl: string): string {
  if (versions.length === 0) {
    return `<div class="empty">
      <p class="empty-title">No versions yet</p>
      <p class="empty-text">Publish your first version to see it here.</p>
    </div>`;
  }

  const items = versions.slice(0, 10).map(v => {
    const date = new Date(v.created_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const liveBadge = v.is_deployed ? '<span class="live-badge">Live</span>' : '';

    return `<li class="version-item">
      <div class="version-info">
        <span class="version-number">v${v.version_no}</span>
        ${liveBadge}
      </div>
      <span class="version-date">${date}</span>
    </li>`;
  }).join('');

  return `<ul class="version-list">${items}</ul>`;
}

function renderViewerTracking(
  viewers: AnalyticsSummary['viewerTracking']
): string {
  if (viewers.length === 0) {
    return `<div class="empty">
      <p class="empty-title">No one shared with yet</p>
      <p class="empty-text">Share this page with others to track who has viewed it.</p>
    </div>`;
  }

  const rows = viewers.map(v => {
    const statusClass = v.hasViewed ? 'status-viewed' : 'status-pending';
    const statusLabel = v.hasViewed ? 'Viewed' : 'Not viewed';
    const first = formatViewTime(v.firstViewedAt);
    const last = formatViewTime(v.lastViewedAt);

    const who = v.name ? `${escapeHtml(v.name)} <span class="viewer-email">${escapeHtml(v.email)}</span>` : escapeHtml(v.email);
    return `<tr>
      <td title="${escapeHtml(v.email)}">${who}</td>
      <td class="${statusClass}">${statusLabel}</td>
      <td>${first}</td>
      <td>${v.viewCount}</td>
      <td>${last}</td>
    </tr>`;
  }).join('');

  return `<table class="viewer-table">
    <thead>
      <tr>
        <th>Person</th>
        <th>Status</th>
        <th>First visit</th>
        <th>Visits</th>
        <th>Last visit</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function formatViewTime(at: string | null): string {
  if (!at) return '—';
  return new Date(at).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderTopList(items: Array<{ name: string; count: number }>, isCountry = false): string {
  if (items.length === 0) {
    return `<div class="empty">
      <p class="empty-title">No data yet</p>
      <p class="empty-text">Data will appear once people start visiting.</p>
    </div>`;
  }

  const listItems = items.map(item => {
    const displayName = isCountry ? getCountryFlag(item.name) + ' ' + item.name : formatReferrer(item.name);
    return `<li class="top-item">
      <span class="top-item-name" title="${escapeHtml(item.name)}">${escapeHtml(displayName)}</span>
      <span class="top-item-count">${item.count.toLocaleString()}</span>
    </li>`;
  }).join('');

  return `<ul class="top-list">${listItems}</ul>`;
}

function formatReferrer(referrer: string): string {
  try {
    const url = new URL(referrer);
    return url.hostname;
  } catch {
    return referrer.length > 30 ? referrer.slice(0, 30) + '...' : referrer;
  }
}

function getCountryFlag(countryCode: string): string {
  const flags: Record<string, string> = {
    US: '🇺🇸', GB: '🇬🇧', CA: '🇨🇦', DE: '🇩🇪', FR: '🇫🇷', JP: '🇯🇵',
    AU: '🇦🇺', BR: '🇧🇷', IN: '🇮🇳', CN: '🇨🇳', MX: '🇲🇽', ES: '🇪🇸',
    IT: '🇮🇹', NL: '🇳🇱', KR: '🇰🇷', RU: '🇷🇺', SE: '🇸🇪', CH: '🇨🇭',
  };
  return flags[countryCode] || '🌍';
}

function notFoundPage(): Response {
  return renderHtmlPage({
    title: 'Page Not Found',
    pageStyles: authPageStyles,
    body: `
  <div class="card">
    <h1 class="error-code">404</h1>
    <p>This page doesn't exist.</p>
  </div>`,
    status: 404,
  });
}

function unauthorizedPage(slug: string, name: string): Response {
  return renderHtmlPage({
    title: `Admin Access - ${escapeHtml(name)}`,
    pageStyles: authPageStyles,
    body: `
  <div class="card">
    <div class="icon icon-primary">🔒</div>
    <h1>Admin Access Required</h1>
    <p>To access the admin panel, generate an admin session from your API token:</p>
    <code>POST /v1/auth/admin-session<br>{"slug": "${escapeHtml(slug)}"}</code>
  </div>`,
    status: 401,
  });
}
