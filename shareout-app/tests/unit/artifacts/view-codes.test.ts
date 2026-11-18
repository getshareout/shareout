import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';
import { applyMigrations, e as baseEnv } from '../helpers/migrated-db';
import {
  MAX_EVENTS_PER_CODE, VIEW_SECONDS_DEFAULT, generateViewCode, normalizeViewCode, redeemViewCode,
  createViewCodes, getLiveViewCode, recordViewCodeEvent, listViewCodes, browserSummary,
} from '../../../src/artifacts/view-codes/store';
import { withOneTimeOwnerNotice } from '../../../src/artifacts/view-codes/viewer';
import { viewCodeGoneCopy } from '../../../src/auth/pages';
import { handleViewCodeAuth, handleViewCodeEvent, readViewPass } from '../../../src/artifacts/view-codes/gate';
import {
  handleCreateViewCodes, handleDisableViewCodes, handleListViewCodes, handleRevokeViewCode, handleSetViewGate,
  handleSetViewGateImage, handleDeleteViewGateImage,
} from '../../../src/artifacts/view-codes/api';
import { checkAccess } from '../../../src/serve/access';
import { dataMiddleware } from '../../../src/data/middleware';
import { handleUpdateArtifact } from '../../../src/artifacts/crud';
import { publishArtifact } from '../../../src/publish/publish-artifact';
import { artifactLocation, verifyAccessToken as passGateAccepts } from '../../../src/auth/artifact-auth';
import { createAccessToken } from '../../../src/token';
import type { ArtifactInfo } from '../../../src/serve/types';

const store = new Map<string, string>();
const kv = {
  get: async (k: string) => store.get(k) ?? null,
  put: async (k: string, v: string) => void store.set(k, v),
  delete: async (k: string) => void store.delete(k),
};
const SLUGS = { get: async () => null, put: async () => undefined, delete: async () => undefined };
const r2 = new Map<string, ArrayBuffer>();
const ARTIFACTS = {
  put: async (k: string, v: ArrayBuffer) => void r2.set(k, v),
  delete: async (k: string) => void r2.delete(k),
  get: async (k: string) => (r2.has(k) ? { body: r2.get(k) } : null),
};
const e = {
  ...baseEnv, SESSION_SECRET: 'test-session-secret', RATE_LIMIT_KV: kv, SLUGS, ARTIFACTS,
  SHAREOUT_BASE_URL: 'https://shareout.test',
} as unknown as Env;

const ART = 'art_vcd';
const owner: AuthUser = { id: 'usr_vcd_owner', email: 'owner@vcd.test', username: null };
const stranger: AuthUser = { id: 'usr_vcd_other', email: 'other@vcd.test', username: null };

const api = (method: string, body?: unknown) =>
  new Request(`https://shareout.test/v1/artifacts/${ART}/view-codes`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });

function codeForm(code: string, ip = '203.0.113.20', ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile') {
  const fd = new FormData();
  fd.set('slug', 'vcd');
  fd.set('artifact_id', ART);
  fd.set('code', code);
  return new Request('https://shareout.test/auth/view-code', {
    method: 'POST', body: fd, headers: { 'cf-connecting-ip': ip, 'User-Agent': ua },
  });
}

const passCookie = (res: Response) => (res.headers.get('Set-Cookie') || '').split(';')[0];

function artifactInfo(): ArtifactInfo {
  return {
    version_id: 'ver_vcd', entrypoint: 'index.html', mobile_entrypoint: null, artifact_id: ART,
    artifact_name: 'Secret', description: null, social_title: null, social_description: null,
    social_image_url: null, thumbnail_ext: null, visibility: 'private', auth_method: 'onetime',
    owner_id: owner.id, workspace_id: null, paused: 0, has_mobile: 0, pwa_config: null,
    artifact_type: 'html', type_metadata: null, access_policy: null, manifest_json: null,
  } as ArtifactInfo;
}

async function newCodes(labels: string[], seconds?: number) {
  const res = await handleCreateViewCodes(api('POST', { recipients: labels, view_seconds: seconds }), e, owner, ART);
  expect(res.status).toBe(201);
  return (await res.json()) as { url: string; view_seconds: number; codes: { id: string; label: string; code: string; link: string }[] };
}

beforeAll(applyMigrations);
beforeEach(async () => {
  store.clear();
  await e.DB.prepare('DELETE FROM artifact_view_code_events').run();
  await e.DB.prepare('DELETE FROM artifact_view_codes').run();
  await e.DB.prepare('DELETE FROM artifact_view_gates').run();
  // A republish test leaves versions/deployments behind; they hold the artifact by FK.
  await e.DB.prepare('DELETE FROM deployments WHERE artifact_id = ?').bind(ART).run();
  await e.DB.prepare('DELETE FROM assets WHERE version_id IN (SELECT id FROM versions WHERE artifact_id = ?)').bind(ART).run();
  await e.DB.prepare('DELETE FROM versions WHERE artifact_id = ?').bind(ART).run();
  await e.DB.prepare('DELETE FROM artifacts WHERE id = ?').bind(ART).run();
  await e.DB.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?), (?, ?)')
    .bind(owner.id, owner.email, stranger.id, stranger.email).run();
  await e.DB.prepare(
    "INSERT INTO artifacts (id, name, slug, owner_id, visibility, auth_method) VALUES (?, 'Secret', 'vcd', ?, 'public', 'google')",
  ).bind(ART, owner.id).run();
});

describe('view codes: the code page look', () => {
  const GATE = { title: 'Carta del socio fundador', message: 'Roberto te comparte el cierre de octubre.', button: 'Abrir la carta' };
  const gatePage = async () => {
    const res = await checkAccess(new Request('https://shareout.test/a/vcd/', { headers: { 'Accept-Language': 'es' } }), e, 'vcd', artifactInfo(), { viewPass: true });
    expect(res!.status).toBe(401);
    return res!.text();
  };

  it("shows the page's own words and the workspace's logo, name and color, and no ShareOut footer when the workspace hides it", async () => {
    await e.DB.prepare("INSERT OR REPLACE INTO workspaces (id, name, slug, owner_id, branding) VALUES ('wsp_vcd', 'Santa Elena', 'vcd-ws', ?, ?)")
      .bind(owner.id, JSON.stringify({ logo_ext: 'png', accent_color: '#D6202A', hide_footer: true })).run();
    await e.DB.prepare("UPDATE artifacts SET workspace_id = 'wsp_vcd' WHERE id = ?").bind(ART).run();
    await newCodes(['Ana']);
    expect((await handleSetViewGate(api('PUT', GATE), e, owner, ART)).status).toBe(200);

    const html = await gatePage();
    for (const text of [GATE.title, GATE.message, GATE.button, 'Santa Elena', '/wl/wsp_vcd.png', '--color-primary:#D6202A']) expect(html).toContain(text);
    expect(html).not.toContain('Powered by');
    expect(html).not.toContain('Ingresá tu código</h1>');
    // A typed code still gets the instruction; a personal link drops it.
    expect(html).toContain('id="vcHint"');

    const list = await (await handleListViewCodes(e, owner, ART)).json() as { gate: unknown };
    expect(list.gate).toEqual({ ...GATE, preview: false, image_url: null });
    // Empty puts the defaults back.
    expect((await handleSetViewGate(api('PUT', {}), e, owner, ART)).status).toBe(200);
    expect(await gatePage()).toContain('Ingresá tu código');
  });

  it('draws a link preview only when the owner turns it on: 200, Open Graph tags, a public image', async () => {
    await newCodes(['Ana']);
    expect(await gatePage()).not.toContain('og:title');
    expect((await handleSetViewGate(api('PUT', { ...GATE, preview: true }), e, owner, ART)).status).toBe(200);
    const png = (bytes: number[]) => new Request(`https://shareout.test/v1/artifacts/${ART}/view-codes/gate/image`, {
      method: 'PUT', body: new Uint8Array(bytes), headers: { 'Content-Type': 'image/png' },
    });
    const up = await handleSetViewGateImage(png([137, 80, 78, 71, 1]), e, owner, ART);
    expect(up.status).toBe(200);
    const { gate } = await up.json() as { gate: { image_url: string; preview: boolean } };
    expect(gate.preview).toBe(true);
    expect(gate.image_url).toMatch(/^\/vg\/art_vcd-[0-9a-f]{12}\.png$/);
    expect(r2.has(`view-gates/${gate.image_url.slice(4)}`)).toBe(true);

    const res = await checkAccess(new Request('https://santaelena.shareout.test/carta/', { headers: { 'Accept-Language': 'es' } }), e, 'vcd', artifactInfo(), { viewPass: true });
    expect(res!.status).toBe(200);
    const html = await res!.text();
    expect(html).toContain(`<meta property="og:title" content="${GATE.title}">`);
    expect(html).toContain(`<meta property="og:description" content="${GATE.message}">`);
    expect(html).toContain(`<meta property="og:image" content="https://santaelena.shareout.test${gate.image_url}">`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('noindex');
    // Still the code page: nothing of the page itself.
    expect(html).toContain('name="code"');

    // A new upload takes a new name and drops the old file; delete removes it.
    const up2 = await (await handleSetViewGateImage(png([137, 80, 78, 71, 2]), e, owner, ART)).json() as { gate: { image_url: string } };
    expect(up2.gate.image_url).not.toBe(gate.image_url);
    expect(r2.has(`view-gates/${gate.image_url.slice(4)}`)).toBe(false);
    expect((await handleDeleteViewGateImage(e, owner, ART)).status).toBe(200);
    expect(r2.has(`view-gates/${up2.gate.image_url.slice(4)}`)).toBe(false);

    // Checked, owner-only, and off again means closed again.
    const gif = new Request('https://shareout.test/x', { method: 'PUT', body: 'GIF89a', headers: { 'Content-Type': 'image/gif' } });
    expect((await handleSetViewGateImage(gif, e, owner, ART)).status).toBe(400);
    expect((await handleSetViewGateImage(png([1]), e, stranger, ART)).status).toBe(403);
    expect((await handleSetViewGate(api('PUT', { ...GATE, preview: 'yes' }), e, owner, ART)).status).toBe(400);
    expect((await handleSetViewGate(api('PUT', GATE), e, owner, ART)).status).toBe(200);
    expect(await gatePage()).not.toContain('og:title');
  });

  it('can be set with the codes, and is checked', async () => {
    const res = await handleCreateViewCodes(api('POST', { recipients: ['Ana'], gate: { title: 'Precios' } }), e, owner, ART);
    expect(res.status).toBe(201);
    expect(await gatePage()).toContain('Precios');
    expect((await handleSetViewGate(api('PUT', { title: 'x'.repeat(81) }), e, owner, ART)).status).toBe(400);
    expect((await handleSetViewGate(api('PUT', { button: 12 }), e, owner, ART)).status).toBe(400);
    expect((await handleSetViewGate(api('PUT', ['x']), e, owner, ART)).status).toBe(400);
    expect((await handleSetViewGate(api('PUT', GATE), e, stranger, ART)).status).toBe(403);
    expect((await handleCreateViewCodes(api('POST', { recipients: ['Ana'], gate: { message: 'y'.repeat(201) } }), e, owner, ART)).status).toBe(400);
  });
});

describe('view codes: format', () => {
  it('generates XXXX-XXXX codes without look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateViewCode();
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  it('accepts what people type: lower case, spaces, dashes', () => {
    expect(normalizeViewCode(' k7m4 - qp9x ')).toBe('K7M4QP9X');
    expect(normalizeViewCode('K7M4QP9')).toBeNull();
    expect(normalizeViewCode('K7M4QP90')).toBeNull(); // 0 is never in a code
    expect(normalizeViewCode(null)).toBeNull();
  });
});

describe('view codes: API', () => {
  it('creates one code per person and makes the page private and one-time', async () => {
    const out = await newCodes(['Ana Gómez', 'Luis · Sucursal Centro']);
    expect(out.view_seconds).toBe(VIEW_SECONDS_DEFAULT);
    expect(out.codes.map((c) => c.label)).toEqual(['Ana Gómez', 'Luis · Sucursal Centro']);
    expect(out.url).toContain('/a/vcd/');
    // Each person gets a personal link: the page URL with their code in the fragment.
    for (const c of out.codes) expect(c.link).toBe(`${out.url}#code=${c.code}`);
    const row = await e.DB.prepare('SELECT visibility, auth_method FROM artifacts WHERE id = ?').bind(ART)
      .first<{ visibility: string; auth_method: string }>();
    expect(row).toEqual({ visibility: 'private', auth_method: 'onetime' });
    // Only the hash is stored.
    const stored = await e.DB.prepare('SELECT code_hash FROM artifact_view_codes WHERE artifact_id = ?').bind(ART).all<{ code_hash: string }>();
    for (const r of stored.results) expect(out.codes.some((c) => r.code_hash.includes(c.code))).toBe(false);
  });

  it('validates recipients and view_seconds', async () => {
    expect((await handleCreateViewCodes(api('POST', { recipients: [] }), e, owner, ART)).status).toBe(400);
    expect((await handleCreateViewCodes(api('POST', { recipients: ['  '] }), e, owner, ART)).status).toBe(400);
    expect((await handleCreateViewCodes(api('POST', { recipients: ['Ana'], view_seconds: 5 }), e, owner, ART)).status).toBe(400);
    expect((await handleCreateViewCodes(api('POST', { recipients: ['Ana'], view_seconds: 1.5 }), e, owner, ART)).status).toBe(400);
    expect((await handleCreateViewCodes(api('POST', { recipients: [{ label: 'Ana' }], view_seconds: 120 }), e, owner, ART)).status).toBe(201);
  });

  it('refuses people without a sharing role, and non-HTML pages', async () => {
    const res = await handleCreateViewCodes(api('POST', { recipients: ['Ana'] }), e, stranger, ART);
    expect(res.status).toBe(403);
    await e.DB.prepare("UPDATE artifacts SET artifact_type = 'csv' WHERE id = ?").bind(ART).run();
    const csv = await handleCreateViewCodes(api('POST', { recipients: ['Ana'] }), e, owner, ART);
    expect(csv.status).toBe(400);
    expect(await csv.json()).toMatchObject({ code: 'ONETIME_HTML_ONLY' });
  });

  it('lists who opened, from what device, and what they tried — never the codes', async () => {
    const { codes } = await newCodes(['Ana', 'Luis']);
    await handleViewCodeAuth(codeForm(codes[0].code), e);
    const open = await getLiveViewCode(e, ART, codes[0].id);
    await recordViewCodeEvent(e, open!.id, 'copy');
    await recordViewCodeEvent(e, open!.id, 'copy');
    await recordViewCodeEvent(e, open!.id, 'left_page');

    const res = await handleListViewCodes(e, owner, ART);
    const body = await res.json() as { enabled: boolean; view_codes: Record<string, unknown>[] };
    expect(body.enabled).toBe(true);
    const ana = body.view_codes.find((c) => c.label === 'Ana')!;
    const luis = body.view_codes.find((c) => c.label === 'Luis')!;
    expect(ana).toMatchObject({ status: 'open', opened_device: 'phone', attempts: { copy: 2, left_page: 1 } });
    expect(luis).toMatchObject({ status: 'unused', opened_at: null, attempts: {} });
    expect(JSON.stringify(body)).not.toContain(codes[0].code);
    expect((await handleListViewCodes(e, stranger, ART)).status).toBe(403);
  });

  it('records the city, region, country and browser it was opened from — never the IP', async () => {
    const { codes } = await newCodes(['Ana']);
    const req = codeForm(codes[0].code, '203.0.113.77',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36');
    Object.defineProperty(req, 'cf', { value: { city: 'Rosario', region: 'Santa Fe', country: 'AR' } });
    expect((await handleViewCodeAuth(req, e)).status).toBe(302);
    const body = await (await handleListViewCodes(e, owner, ART)).json() as { view_codes: Record<string, unknown>[] };
    expect(body.view_codes[0]).toMatchObject({
      opened_device: 'phone', opened_browser: 'Chrome · Android', opened_city: 'Rosario', opened_region: 'Santa Fe', opened_country: 'AR',
    });
    expect(JSON.stringify(body)).not.toContain('203.0.113.77');
    const row = await e.DB.prepare('SELECT * FROM artifact_view_codes WHERE id = ?').bind(codes[0].id).first();
    expect(JSON.stringify(row)).not.toContain('203.0.113.77');
  });

  it('names the browser and system from the user agent', () => {
    expect(browserSummary('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe('Safari · iOS');
    expect(browserSummary('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1')).toBe('Chrome · iOS');
    expect(browserSummary('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0')).toBe('Edge · Windows');
    expect(browserSummary('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')).toBe('Chrome · macOS');
    expect(browserSummary('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36')).toBe('Samsung Internet · Android');
    expect(browserSummary(null)).toBeNull();
  });

  it('revokes one code, and turning it off revokes all and goes back to sign-in', async () => {
    const { codes } = await newCodes(['Ana', 'Luis']);
    expect((await handleRevokeViewCode(e, owner, ART, codes[0].id)).status).toBe(200);
    expect((await handleRevokeViewCode(e, owner, ART, 'vcd_nope')).status).toBe(404);
    expect((await handleViewCodeAuth(codeForm(codes[0].code), e)).status).toBe(401);

    expect((await handleDisableViewCodes(e, owner, ART)).status).toBe(200);
    const row = await e.DB.prepare('SELECT visibility, auth_method FROM artifacts WHERE id = ?').bind(ART)
      .first<{ visibility: string; auth_method: string }>();
    expect(row).toEqual({ visibility: 'private', auth_method: 'google' });
    expect((await handleViewCodeAuth(codeForm(codes[1].code), e)).status).toBe(404);
  });
});

describe('view codes: the gate', () => {
  it('a code opens the page once, with a pass that lasts exactly its window', async () => {
    const { codes } = await newCodes(['Ana'], 90);
    const first = await handleViewCodeAuth(codeForm(codes[0].code.toLowerCase()), e);
    expect(first.status).toBe(302);
    expect(first.headers.get('Location')).toBe('/a/vcd/');
    const cookie = first.headers.get('Set-Cookie')!;
    expect(cookie).toContain(`shareout_access_${ART}=`);
    expect(cookie).toMatch(/Max-Age=(89|90)\b/);
    expect(cookie).toContain('HttpOnly');

    const again = await handleViewCodeAuth(codeForm(codes[0].code, '198.51.100.4'), e);
    expect(again.status).toBe(401);
    expect(again.headers.get('Set-Cookie')).toBeNull();
    expect(await again.text()).toMatch(/already used|ya se usó/);
  });

  it('two devices racing the same code: exactly one wins', async () => {
    const { codes } = await newCodes(['Ana']);
    const from = { device: 'computer' as const, browser: null, city: null, region: null, country: null };
    const results = await Promise.all([1, 2, 3].map(() => redeemViewCode(e, ART, codes[0].code, from)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('a wrong code says so, and guessing is throttled', async () => {
    await newCodes(['Ana']);
    const wrong = await handleViewCodeAuth(codeForm('AAAA-BBBB'), e);
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toMatch(/doesn’t work|no funciona/);
    let last = wrong;
    for (let i = 0; i < 25; i++) last = await handleViewCodeAuth(codeForm('AAAA-BBBB'), e);
    expect(last.status).toBe(429);
  });

  it('the gate page never tells the viewer the page is one-time or timed', async () => {
    await newCodes(['Ana']);
    const res = await checkAccess(new Request('https://shareout.test/a/vcd/', { headers: { 'Accept-Language': 'es' } }), e, 'vcd', artifactInfo(), { viewPass: true });
    expect(res!.status).toBe(401);
    const html = await res!.text();
    const card = html.slice(html.indexOf('<div class="card">'), html.indexOf('</form>'));
    expect(card).toContain('Ingresá tu código');
    expect(card).not.toMatch(/una vez|segundos|expira|vence|once|seconds|expire/i);
  });

  it('the page closes with a thank-you, and the owner is told their view is not locked', async () => {
    expect(viewCodeGoneCopy('es').title).toBe('¡Gracias por leerlo!');
    expect(viewCodeGoneCopy('en').title).toBe('Thanks for reading');
    const res = withOneTimeOwnerNotice(new Response('<html><body><p id="page">carta</p></body></html>', { headers: { 'Content-Type': 'text/html' } }), 'es');
    const html = await res.text();
    expect(html).toContain('<p id="page">carta</p>');
    expect(html).toContain('Lo ves con tu cuenta, por eso sin bloqueo.');
    expect(html.indexOf('so-otv-owner')).toBeGreaterThan(html.indexOf('id="page"'));
  });

  it('a personal link fills the code in from the fragment and leaves only Open', async () => {
    await newCodes(['Ana']);
    const res = await checkAccess(new Request('https://shareout.test/a/vcd/', { headers: { 'Accept-Language': 'es' } }), e, 'vcd', artifactInfo(), { viewPass: true });
    const html = await res!.text();
    const script = html.slice(html.indexOf('<script>', html.indexOf('</form>')), html.lastIndexOf('</script>'));
    expect(script).toContain('location.hash');
    expect(script).toContain('history.replaceState');
    expect(script).toContain('Listo para abrir');
    expect(script).toContain('Tocá Abrir para ver este contenido.');
    expect(script).not.toMatch(/una vez|segundos|expira|vence/i);
    // It never submits on its own: a link preview or scanner that runs scripts cannot spend the code.
    expect(script).not.toMatch(/\.submit\(|requestSubmit|\.click\(/);
  });

  it('the pass opens the page itself only — every other surface stays closed to it', async () => {
    const { codes } = await newCodes(['Ana']);
    const cookie = passCookie(await handleViewCodeAuth(codeForm(codes[0].code), e));
    const req = new Request('https://shareout.test/a/vcd/', { headers: { Cookie: cookie } });
    expect(await checkAccess(req, e, 'vcd', artifactInfo(), { viewPass: true })).toBeNull();
    expect((await checkAccess(req, e, 'vcd', artifactInfo()))!.status).toBe(401);
    expect(await readViewPass(req, e, ART)).toMatchObject({ label: 'Ana' });
  });

  it('the pass dies when the window ends, or the code is revoked', async () => {
    const { codes } = await newCodes(['Ana', 'Luis'], 60);
    const cookie = passCookie(await handleViewCodeAuth(codeForm(codes[0].code), e));
    const req = new Request('https://shareout.test/a/vcd/', { headers: { Cookie: cookie } });
    await e.DB.prepare('UPDATE artifact_view_codes SET opened_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - 61_000).toISOString(), codes[0].id).run();
    expect(await readViewPass(req, e, ART)).toBeNull();

    const cookie2 = passCookie(await handleViewCodeAuth(codeForm(codes[1].code), e));
    const req2 = new Request('https://shareout.test/a/vcd/', { headers: { Cookie: cookie2 } });
    expect(await readViewPass(req2, e, ART)).not.toBeNull();
    await handleRevokeViewCode(e, owner, ART, codes[1].id);
    expect(await readViewPass(req2, e, ART)).toBeNull();
    const list = await listViewCodes(e, ART);
    expect(list.find((c) => c.label === 'Ana')!.status).toBe('viewed');
    expect(list.find((c) => c.label === 'Ana')!.closed_at).not.toBeNull();
  });
});

describe('view codes: never a data credential', () => {
  it('neither the pass nor the frame token reads the page data, even if the page is later marked public', async () => {
    const { codes } = await newCodes(['Ana']);
    const pass = passCookie(await handleViewCodeAuth(codeForm(codes[0].code), e)).split('=').slice(1).join('=');
    const frame = await createAccessToken(ART, 'content_otv', e, 60);
    for (const visibility of ['private', 'public']) {
      await e.DB.prepare('UPDATE artifacts SET visibility = ? WHERE id = ?').bind(visibility, ART).run();
      for (const token of [pass, frame]) {
        const res = await dataMiddleware(new Request(`https://shareout.test/v1/data/${ART}/json/x`, { headers: { Authorization: `Bearer ${token}` } }), e, ART);
        expect(res).toBeInstanceOf(Response);
        expect([401, 403]).toContain((res as Response).status);
      }
    }
  });
});

describe('view codes: the page stays closed', () => {
  it('refuses opening a one-time page until one-time view is off', async () => {
    await newCodes(['Ana']);
    const patch = (visibility: string) => new Request(`https://shareout.test/v1/artifacts/${ART}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility }),
    });
    const res = await handleUpdateArtifact(patch('public'), e, owner, ART);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'ONETIME_VIEW_ON' });
    const row = await e.DB.prepare('SELECT visibility FROM artifacts WHERE id = ?').bind(ART).first<{ visibility: string }>();
    expect(row!.visibility).toBe('private');
  });

  it('a republish keeps one-time view on and the page private, and says so', async () => {
    const { codes } = await newCodes(['Ana']);
    const out = await publishArtifact(e, owner, {
      name: 'Secret', slug: 'vcd', entrypoint: 'index.html', visibility: 'public', authMethod: 'google',
      files: [{ path: 'index.html', content: '<h1>v2</h1>', mime: 'text/html' }],
      shareWith: [], credentials: [], workspaceId: null, folderId: null, artifactType: 'html', artifactId: ART,
    } as unknown as Parameters<typeof publishArtifact>[2]);
    const row = await e.DB.prepare('SELECT visibility, auth_method FROM artifacts WHERE id = ?').bind(ART)
      .first<{ visibility: string; auth_method: string }>();
    expect(row).toEqual({ visibility: 'private', auth_method: 'onetime' });
    expect((out as unknown as { visibility: string }).visibility).toBe('private');
    expect(JSON.stringify(out)).toContain('one-time codes only');
    // The codes still work.
    expect((await handleViewCodeAuth(codeForm(codes[0].code), e)).status).toBe(302);
  });

  it('a pass is never a password pass, and the redirect slug cannot leave the host', async () => {
    const { codes } = await newCodes(['Ana']);
    const cookie = passCookie(await handleViewCodeAuth(codeForm(codes[0].code), e));
    expect(await passGateAccepts(new Request('https://shareout.test/', { headers: { Cookie: cookie } }), e, ART)).toBe(false);
    expect(artifactLocation(new Request('https://shareout.test/auth/view-code'), '/evil.com', e)).toBe('/a/%2Fevil.com/');
  });

  it('bad guesses from many places do not lock out a real holder', async () => {
    const { codes } = await newCodes(['Ana']);
    for (let i = 0; i < 220; i++) await handleViewCodeAuth(codeForm('AAAA-BBBB', `10.9.${Math.floor(i / 200)}.${i % 200}`), e);
    expect((await handleViewCodeAuth(codeForm(codes[0].code, '198.51.100.99'), e)).status).toBe(302);
  });
});

describe('view codes: attempt log', () => {
  const event = (cookie: string | null, body: unknown, origin = 'https://shareout.test') =>
    new Request('https://shareout.test/auth/view-code/event', {
      method: 'POST', body: JSON.stringify(body),
      headers: { 'Content-Type': 'text/plain', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    });

  it('logs attempts for a live pass only, from this origin only, known kinds only', async () => {
    const { codes } = await newCodes(['Ana']);
    const cookie = passCookie(await handleViewCodeAuth(codeForm(codes[0].code), e));
    expect((await handleViewCodeEvent(event(cookie, { artifact_id: ART, kind: 'print' }), e)).status).toBe(204);
    expect((await handleViewCodeEvent(event(null, { artifact_id: ART, kind: 'print' }), e)).status).toBe(403);
    expect((await handleViewCodeEvent(event(cookie, { artifact_id: ART, kind: 'print' }, 'https://evil.test'), e)).status).toBe(403);
    expect((await handleViewCodeEvent(event(cookie, { artifact_id: ART, kind: 'rm -rf' }), e)).status).toBe(400);
    const rows = await e.DB.prepare('SELECT kind FROM artifact_view_code_events WHERE code_id = ?').bind(codes[0].id).all<{ kind: string }>();
    expect(rows.results.map((r) => r.kind)).toEqual(['print']);
  });

  it('caps the log per code', async () => {
    const [code] = await createViewCodes(e, ART, ['Ana'], 90, owner.id);
    for (let i = 0; i < MAX_EVENTS_PER_CODE + 10; i++) await recordViewCodeEvent(e, code.id, 'left_page');
    const n = await e.DB.prepare('SELECT COUNT(*) AS n FROM artifact_view_code_events WHERE code_id = ?').bind(code.id).first<{ n: number }>();
    expect(n!.n).toBe(MAX_EVENTS_PER_CODE);
  });
});
