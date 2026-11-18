// How the one-time code page and its closing screen look: the workspace's logo, name and color
// (workspaces.branding) and the page's own words (artifact_view_gates), when they are set.
// Everything here is shown before a code is checked, to anyone holding the link — and, with the
// link preview on, to the apps that draw a card for the link (WhatsApp, Slack, iMessage…).
import type { Env } from '../../types';
import { brandingResponse, parseBranding } from '../../workspaces/branding';

export const GATE_TEXT_LIMITS = { title: 80, message: 200, button: 30 } as const;
type GateField = keyof typeof GATE_TEXT_LIMITS;

export const GATE_IMAGE_MAX_BYTES = 1024 * 1024;
const GATE_IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export interface ViewGateText { title: string | null; message: string | null; button: string | null }
export interface ViewGateBrand { name: string; logoUrl: string | null; accent: string | null; hideFooter: boolean }
export interface ViewGateLook {
  brand: ViewGateBrand | null;
  text: ViewGateText;
  /** The link preview is on: the code page answers 200 with Open Graph tags. */
  preview: boolean;
  /** Path of the public preview image (`/vg/<file>`), when one was uploaded. */
  imageUrl: string | null;
}

export const NO_GATE_TEXT: ViewGateText = { title: null, message: null, button: null };

export async function loadViewGateLook(env: Env, artifactId: string): Promise<ViewGateLook> {
  const row = await env.DB.prepare(
    `SELECT g.title, g.message, g.button, g.preview, g.image, w.id AS ws_id, w.name AS ws_name, w.branding
       FROM artifacts a
       LEFT JOIN artifact_view_gates g ON g.artifact_id = a.id
       LEFT JOIN workspaces w ON w.id = a.workspace_id
      WHERE a.id = ?`,
  ).bind(artifactId).first<{
    title: string | null; message: string | null; button: string | null; preview: number | null; image: string | null;
    ws_id: string | null; ws_name: string | null; branding: string | null;
  }>();
  if (!row) return { brand: null, text: { ...NO_GATE_TEXT }, preview: false, imageUrl: null };
  const text = { title: row.title ?? null, message: row.message ?? null, button: row.button ?? null };
  const preview = row.preview === 1;
  const imageUrl = row.image ? `/vg/${row.image}` : null;
  if (!row.ws_id) return { brand: null, text, preview, imageUrl };
  const b = parseBranding(row.branding);
  return {
    brand: { name: row.ws_name || '', logoUrl: brandingResponse(row.ws_id, b).logo_url, accent: b.accent_color, hideFooter: b.hide_footer },
    text,
    preview,
    imageUrl,
  };
}

/** What the API shows of the gate. */
export function gateResponse(look: ViewGateLook) {
  return { ...look.text, preview: look.preview, image_url: look.imageUrl };
}

/**
 * `{ title?, message?, button?, preview? }` → the page's gate. A missing or empty text field
 * goes back to the default; a missing `preview` is off.
 */
export function parseGate(body: unknown): { text: ViewGateText; preview: boolean } | { error: string; param: string } {
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
  if (src.preview !== undefined && typeof src.preview !== 'boolean') return { error: 'preview must be true or false', param: 'gate.preview' };
  return { text, preview: src.preview === true };
}

/** Save the gate's words and preview switch; the preview image is kept. */
export async function saveGate(env: Env, artifactId: string, gate: { text: ViewGateText; preview: boolean }): Promise<void> {
  const { text, preview } = gate;
  await env.DB.prepare(
    `INSERT INTO artifact_view_gates (artifact_id, title, message, button, preview, updated_at)
     VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(artifact_id) DO UPDATE SET title = excluded.title, message = excluded.message,
       button = excluded.button, preview = excluded.preview, updated_at = excluded.updated_at`,
  ).bind(artifactId, text.title, text.message, text.button, preview ? 1 : 0).run();
}

/** Why these bytes cannot be the preview image, or null when they can. */
export function gateImageProblem(contentType: string, byteLength: number): { error: string; code: string } | null {
  if (!GATE_IMAGE_TYPES[contentType.split(';')[0].trim().toLowerCase()]) {
    return { error: 'The preview image must be a PNG, JPG or WEBP', code: 'INVALID_CONTENT_TYPE' };
  }
  if (byteLength === 0) return { error: 'Empty file', code: 'EMPTY_FILE' };
  if (byteLength > GATE_IMAGE_MAX_BYTES) return { error: 'The preview image is at most 1 MB', code: 'TOO_LARGE' };
  return null;
}

/**
 * Store a checked preview image under a fresh name (so no cache, ours or WhatsApp's, keeps
 * the old one) and drop the previous file. Returns the new public path.
 */
export async function storeGateImage(env: Env, artifactId: string, body: ArrayBuffer, contentType: string): Promise<string> {
  const ext = GATE_IMAGE_TYPES[contentType.split(';')[0].trim().toLowerCase()];
  const rand = crypto.getRandomValues(new Uint8Array(6));
  const file = `${artifactId}-${Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('')}.${ext}`;
  await env.ARTIFACTS.put(`view-gates/${file}`, body, { httpMetadata: { contentType: contentType.split(';')[0].trim() } });
  const old = await env.DB.prepare('SELECT image FROM artifact_view_gates WHERE artifact_id = ?')
    .bind(artifactId).first<{ image: string | null }>();
  await env.DB.prepare(
    `INSERT INTO artifact_view_gates (artifact_id, image, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(artifact_id) DO UPDATE SET image = excluded.image, updated_at = excluded.updated_at`,
  ).bind(artifactId, file).run();
  if (old?.image) await env.ARTIFACTS.delete(`view-gates/${old.image}`);
  return `/vg/${file}`;
}

export async function deleteGateImage(env: Env, artifactId: string): Promise<void> {
  const old = await env.DB.prepare('SELECT image FROM artifact_view_gates WHERE artifact_id = ?')
    .bind(artifactId).first<{ image: string | null }>();
  if (!old?.image) return;
  await env.DB.prepare("UPDATE artifact_view_gates SET image = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE artifact_id = ?")
    .bind(artifactId).run();
  await env.ARTIFACTS.delete(`view-gates/${old.image}`);
}
