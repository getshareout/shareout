// How the one-time code page and its closing screen look: the workspace's logo, name and color
// (workspaces.branding) and the page's own words (artifact_view_gates), when they are set.
// Everything here is shown before a code is checked, to anyone holding the link.
import type { Env } from '../../types';
import { brandingResponse, parseBranding } from '../../workspaces/branding';

export const GATE_TEXT_LIMITS = { title: 80, message: 200, button: 30 } as const;
type GateField = keyof typeof GATE_TEXT_LIMITS;

export interface ViewGateText { title: string | null; message: string | null; button: string | null }
export interface ViewGateBrand { name: string; logoUrl: string | null; accent: string | null; hideFooter: boolean }
export interface ViewGateLook { brand: ViewGateBrand | null; text: ViewGateText }

export const NO_GATE_TEXT: ViewGateText = { title: null, message: null, button: null };

export async function loadViewGateLook(env: Env, artifactId: string): Promise<ViewGateLook> {
  const row = await env.DB.prepare(
    `SELECT g.title, g.message, g.button, w.id AS ws_id, w.name AS ws_name, w.branding
       FROM artifacts a
       LEFT JOIN artifact_view_gates g ON g.artifact_id = a.id
       LEFT JOIN workspaces w ON w.id = a.workspace_id
      WHERE a.id = ?`,
  ).bind(artifactId).first<{
    title: string | null; message: string | null; button: string | null;
    ws_id: string | null; ws_name: string | null; branding: string | null;
  }>();
  if (!row) return { brand: null, text: { ...NO_GATE_TEXT } };
  const text = { title: row.title ?? null, message: row.message ?? null, button: row.button ?? null };
  if (!row.ws_id) return { brand: null, text };
  const b = parseBranding(row.branding);
  return {
    brand: { name: row.ws_name || '', logoUrl: brandingResponse(row.ws_id, b).logo_url, accent: b.accent_color, hideFooter: b.hide_footer },
    text,
  };
}

/** `{ title?, message?, button? }` → the page's gate text; a missing or empty field goes back to the default. */
export function parseGateText(body: unknown): { text: ViewGateText } | { error: string; param: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { error: 'gate must be an object', param: 'gate' };
  const src = body as Record<string, unknown>;
  const text: ViewGateText = { ...NO_GATE_TEXT };
  for (const field of Object.keys(GATE_TEXT_LIMITS) as GateField[]) {
    const v = src[field];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') return { error: `${field} must be a string`, param: `gate.${field}` };
    // eslint-disable-next-line no-control-regex
    const clean = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (clean.length > GATE_TEXT_LIMITS[field]) {
      return { error: `${field} is at most ${GATE_TEXT_LIMITS[field]} characters`, param: `gate.${field}` };
    }
    text[field] = clean || null;
  }
  return { text };
}

export async function saveGateText(env: Env, artifactId: string, text: ViewGateText): Promise<void> {
  if (!text.title && !text.message && !text.button) {
    await env.DB.prepare('DELETE FROM artifact_view_gates WHERE artifact_id = ?').bind(artifactId).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO artifact_view_gates (artifact_id, title, message, button, updated_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(artifact_id) DO UPDATE SET title = excluded.title, message = excluded.message,
       button = excluded.button, updated_at = excluded.updated_at`,
  ).bind(artifactId, text.title, text.message, text.button).run();
}
