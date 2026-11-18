// @vitest-environment happy-dom
//
// The one share dialog (home tab, Details rail, artifact viewer): add anyone by email —
// a teammate with no account yet or someone outside the workspace — see who has access,
// choose who else can open it, and never offer Public where it can't happen.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shareModalScript } from '../../../src/components/share-modal';

type Json = Record<string, unknown>;
type Call = { url: string; method: string; body: Json | undefined };
type Win = Window & Record<string, unknown> & { openShare: (...a: unknown[]) => void; closeShare: () => void };

const w = () => window as unknown as Win;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const respond = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const text = () => $('#soShareOverlay')!.textContent || '';
const visOptions = () => [...document.querySelectorAll('#soShareVis option')].map((o) => (o as HTMLOptionElement).value);
const toast = () => w().showToast as ReturnType<typeof vi.fn>;

let calls: Call[];
let meta: Json;
let collaborators: Json[];
let postCollab: (body: Json) => Response;

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete (window as unknown as Json).openShare;
  delete (window as unknown as Json).closeShare;
  w().showToast = vi.fn();
  calls = [];
  meta = {
    id: 'art_1', name: 'Reporte Ventas', slug: 'reporte-ventas', visibility: 'private',
    workspace_id: 'wsp_1', workspace_name: 'Acme', can_edit: true, can_open_public: false,
    url: 'https://acme.shareout.site/reporte-ventas/', owner: { name: 'Dana', email: 'dana@acme.com' },
  };
  collaborators = [];
  postCollab = (b) => {
    const emails = b.emails as string[];
    return respond(200, {
      success: true, added: emails,
      notified: { sent: emails, failed: [], rate_limited: false },
      collaborators: [...emails.map((e) => ({ email: e, role: b.role, added_at: 'x', pending: true })), ...collaborators],
    });
  };
  globalThis.fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) as Json : undefined;
    calls.push({ url, method, body });
    if (url === '/v1/artifacts/art_1' && method === 'GET') return respond(200, meta);
    if (url === '/v1/artifacts/art_1' && method === 'PATCH') return respond(200, { visibility: body!.visibility });
    if (url === '/v1/artifacts/art_1/collaborators' && method === 'GET') return respond(200, { collaborators });
    if (url === '/v1/artifacts/art_1/collaborators' && method === 'POST') return postCollab(body!);
    if (url.startsWith('/v1/artifacts/art_1/collaborators/') && method === 'DELETE') return respond(200, { success: true, collaborators: [] });
    if (url === '/v1/workspaces/wsp_1/members') return respond(200, { members: [{ email: 'ana@acme.com', name: 'Ana' }] });
    if (url === '/v1/artifacts/art_1/share') return respond(200, { success: true, sent: body!.recipients, failed: [] });
    return respond(404, { error: 'nope' });
  }) as unknown as typeof fetch;
});

async function open(locale: 'en' | 'es' = 'en'): Promise<void> {
  new Function(shareModalScript({ baseUrl: '', locale }))();
  w().openShare('art_1', 'reporte-ventas', 'Reporte Ventas', true);
  await flush();
}
function type(v: string): void {
  const i = $('#soShareInput') as HTMLInputElement;
  i.value = v;
  i.dispatchEvent(new Event('input', { bubbles: true }));
}
const enter = () => $('#soShareInput')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
const posts = () => calls.filter((c) => c.method === 'POST');

describe('share dialog — someone who can edit', () => {
  it('is one panel: add people, who has access, who else can open it, copy link', async () => {
    await open();
    expect($('#soShareTitle')!.textContent).toBe('Share “Reporte Ventas”');
    expect($('#soShareInput')).not.toBeNull();
    expect(text()).toContain('People with access');
    expect(text()).toContain('Dana');
    expect(text()).toContain('Owner');
    expect(text()).toContain('Who else can open it');
    expect(text()).toContain('Nobody else can open it, even with the link.');
    expect($('[data-sh="copy"]')!.textContent).toContain('Copy link');
  });

  it('names the workspace in plain words and hides Public when the workspace does not allow it', async () => {
    await open();
    expect(visOptions()).toEqual(['private', 'workspace']);
    expect($('#soShareVis option[value="workspace"]')!.textContent).toBe('Everyone in Acme');
    expect(document.querySelector('[disabled]')).toBeNull();
    expect(text()).not.toContain('turned off');
  });

  it('offers Public where it is allowed, and keeps it on an artifact that already is public', async () => {
    meta.can_open_public = true;
    await open();
    expect(visOptions()).toEqual(['private', 'workspace', 'public']);

    meta.can_open_public = false;
    meta.visibility = 'public';
    w().openShare('art_1', 'reporte-ventas', 'Reporte Ventas', true);
    await flush();
    expect(visOptions()).toContain('public');
    expect((($('#soShareVis') as HTMLSelectElement)).value).toBe('public');
  });

  it('invites an outside email with no account as a viewer, emails them the link, and marks them invited', async () => {
    await open();
    type('proveedor@externo.com');
    enter();
    // Shows at once, before the server answers.
    const row = $('[data-person="proveedor@externo.com"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('Invited · hasn’t signed in yet');
    expect(($('#soShareInput') as HTMLInputElement).value).toBe('');
    await flush();
    const post = posts().find((c) => c.url === '/v1/artifacts/art_1/collaborators')!;
    expect(post.body).toMatchObject({ emails: ['proveedor@externo.com'], role: 'viewer', notify: true });
    expect(toast()).toHaveBeenCalledWith('proveedor@externo.com can see it now. We emailed them the link.', 'success');
  });

  it('invites a teammate on the workspace domain who has no account yet the same way', async () => {
    await open();
    type('nuevo@acme.com');
    const pick = $('[data-pick="nuevo@acme.com"]');
    expect(pick!.textContent).toContain('Invite nuevo@acme.com');
    pick!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(posts()[0].body).toMatchObject({ emails: ['nuevo@acme.com'], role: 'viewer', notify: true });
    expect($('[data-person="nuevo@acme.com"]')).not.toBeNull();
  });

  it('suggests workspace members by name', async () => {
    await open();
    type('an');
    expect($('[data-pick="ana@acme.com"]')!.textContent).toContain('Ana');
    enter();
    await flush();
    expect(posts()[0].body).toMatchObject({ emails: ['ana@acme.com'] });
  });

  it('invites a pasted list of emails in one go', async () => {
    await open();
    type('a@x.com, b@y.com');
    enter();
    await flush();
    expect(posts()[0].body).toMatchObject({ emails: ['a@x.com', 'b@y.com'] });
    expect(toast()).toHaveBeenCalledWith('2 people can see it now. We emailed them the link.', 'success');
  });

  it('sends the note when one is written', async () => {
    await open();
    $('[data-sh="msg"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    (($('#soShareMsg') as HTMLTextAreaElement)).value = 'Mirá el reporte';
    type('ana@acme.com');
    $('[data-sh="invite"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(posts()[0].body).toMatchObject({ message: 'Mirá el reporte' });
  });

  it('says so when access was given but the email did not go out', async () => {
    postCollab = (b) => respond(200, { success: true, added: b.emails, notified: { sent: [], failed: [{ email: 'x@y.com', error: 'send_failed' }], rate_limited: false }, collaborators: [] });
    await open();
    type('x@y.com');
    enter();
    await flush();
    expect(toast()).toHaveBeenCalledWith('x@y.com has access, but the email didn’t go out. Copy the link and send it to them.', 'warning');
  });

  it('a refusal drops the row and puts the email back with the server reason', async () => {
    postCollab = () => respond(403, { error: 'Only editors can add people' });
    await open();
    type('x@y.com');
    enter();
    await flush();
    expect($('[data-person="x@y.com"]')).toBeNull();
    expect(($('#soShareInput') as HTMLInputElement).value).toBe('x@y.com');
    expect($('#soShareStatus')!.textContent).toBe('Only editors can add people');
  });

  it('rejects something that is not an email without calling the server', async () => {
    await open();
    type('not-an-email');
    $('[data-sh="invite"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(posts()).toHaveLength(0);
    expect($('#soShareStatus')!.textContent).toBe('That doesn’t look like an email.');
  });

  it('changing who can open it saves it and tells the page', async () => {
    const seen: unknown[] = [];
    window.addEventListener('so:share-changed', (e) => seen.push((e as CustomEvent).detail));
    await open();
    const sel = $('#soShareVis') as HTMLSelectElement;
    sel.value = 'workspace';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(text()).toContain('Anyone in Acme who signs in can open it.');
    await flush();
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ visibility: 'workspace' });
    expect(seen).toContainEqual({ id: 'art_1', visibility: 'workspace' });
  });

  it('changes and removes someone\'s access', async () => {
    collaborators = [{ email: 'ana@acme.com', role: 'viewer', added_at: 'x', pending: false }];
    await open();
    const role = $('[data-role-for="ana@acme.com"]') as HTMLSelectElement;
    role.value = 'editor';
    role.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(posts()[0].body).toEqual({ emails: ['ana@acme.com'], role: 'editor', notify: false });
    $('[data-rm="ana@acme.com"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect($('[data-person="ana@acme.com"]')).toBeNull();
    await flush();
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/v1/artifacts/art_1/collaborators/ana%40acme.com')).toBe(true);
  });

  it('copies the link and says who can open it', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await open();
    $('[data-sh="copy"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(writeText).toHaveBeenCalledWith('https://acme.shareout.site/reporte-ventas/');
    expect(toast()).toHaveBeenCalledWith('Link copied. Only the people with access can open it.', 'success');
  });

  it('closes on Done and on Escape', async () => {
    await open();
    const ov = $('#soShareOverlay')!;
    expect(ov.classList.contains('is-open')).toBe(true);
    (document.querySelector('.so-sh-foot [data-sh="close"]') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(ov.classList.contains('is-open')).toBe(false);
    w().openShare('art_1', 'reporte-ventas', 'Reporte Ventas', true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(ov.classList.contains('is-open')).toBe(false);
  });
});

describe('share dialog — someone who can only view', () => {
  beforeEach(() => { meta.can_edit = false; delete meta.can_open_public; });

  it('shows who can open it and lets them email the link, without add-people or a visibility picker', async () => {
    await open();
    expect($('#soShareVis')).toBeNull();
    expect($('[data-sh="invite"]')).toBeNull();
    expect(text()).toContain('Who can open it');
    expect(text()).toContain('ask Dana');
    type('colega@acme.com');
    $('[data-sh="sendlink"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(posts()[0]).toMatchObject({ url: '/v1/artifacts/art_1/share', body: { recipients: ['colega@acme.com'], role: 'none' } });
    expect(calls.some((c) => c.url.endsWith('/collaborators'))).toBe(false);
  });
});

describe('share dialog — Spanish', () => {
  it('speaks rioplatense Spanish', async () => {
    await open('es');
    expect($('#soShareTitle')!.textContent).toBe('Compartir “Reporte Ventas”');
    expect(text()).toContain('Personas con acceso');
    expect(text()).toContain('Quién más puede abrirlo');
    expect($('#soShareVis option[value="workspace"]')!.textContent).toBe('Todos en Acme');
    expect(text()).toContain('entra con un código que le mandamos, sin contraseña');
  });

  it('the home bundle (no locale passed) follows WSX_LOCALE', async () => {
    w().WSX_LOCALE = 'es';
    new Function(shareModalScript({ baseUrl: '' }))();
    w().openShare('art_1', 'reporte-ventas', 'Reporte Ventas', true);
    await flush();
    expect($('#soShareTitle')!.textContent).toBe('Compartir “Reporte Ventas”');
    delete w().WSX_LOCALE;
  });
});
