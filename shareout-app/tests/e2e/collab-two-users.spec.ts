import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { resolveE2eToken } from './helpers/agent-qa';

/*
 * Real-time collaboration e2e: two authenticated users editing the same artifact.
 *
 * Product model (Live Studio):
 * - Presence, cursors, and soft locks ride JSON awareness/lock frames over the editor WS.
 * - Text and structure sync live via Yjs binary frames (TextCrdt + ElementSync) — not on publish.
 * - Publish promotes a personal draft for viewers; it does not re-broadcast full HTML as
 *   html-update, and the client no longer applies html-update / remote-conflict-dialog for that.
 *
 * Setup: seed via publish API (Bearer from resolveE2eToken), grant two test emails editor access,
 * log each browser in via localhost-only /auth/dev. Collab auto-connects on editor load.
 *
 * Requires `npx wrangler dev --port 55162` (Playwright webServer). On localhost the token is
 * minted against the local worker so a stale ~/.shareout/credentials cannot 401 publish.
 */

const USER_A = 'e2e-collab-a@shareout.test';
const USER_B = 'e2e-collab-b@shareout.test';

// Stable data-editor-id attributes are pre-stamped so both clients share element identity.
// (The editor stamps random per-client ids on any element lacking one, which would break
// cross-client element/text sync — saved artifacts carry these ids already.)
const SEED_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Collab E2E</title></head>
<body>
  <h1 id="title" data-editor-id="ed-title">Hello collab</h1>
  <p id="para" data-editor-id="ed-para">Editable paragraph</p>
  <p id="para2" data-editor-id="ed-para2">Second paragraph</p>
</body></html>`;

// Auth: resolveE2eToken mints a local token on localhost (ignores stale ~/.shareout/credentials
// unless SHAREOUT_CREDENTIALS is set). Publish + /auth/dev collab sessions use that token.
// Local-only suite — no CI job runs Playwright.
let TOKEN: string | null = null;
const BASE = process.env.SHAREOUT_E2E_BASE_URL || 'http://localhost:55162';

let seedCounter = 0;

/** Publish a throwaway artifact and grant both test users editor access. Returns its slug + id. */
async function seedArtifact(browser: Browser): Promise<{ id: string; slug: string }> {
  const api = await browser.newContext({ baseURL: BASE });
  try {
    const slug = `e2e-collab-${Date.now()}-${seedCounter++}`;
    const pub = await api.request.post('/v1/publish', {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      data: { name: `E2E Collab ${slug}`, slug, files: [{ path: 'index.html', content: SEED_HTML, mime: 'text/html' }] },
    });
    expect(pub.ok(), `publish failed: ${pub.status()} ${await pub.text()}`).toBeTruthy();
    const body = await pub.json();
    const id = body.artifact.id as string;

    for (const email of [USER_A, USER_B]) {
      const res = await api.request.post(`/v1/artifacts/${id}/collaborators`, {
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        data: { emails: [email], role: 'editor' },
      });
      expect(res.ok(), `add collaborator ${email} failed: ${res.status()}`).toBeTruthy();
    }
    return { id, slug };
  } finally {
    await api.close();
  }
}

async function deleteArtifact(browser: Browser, id: string): Promise<void> {
  const api = await browser.newContext({ baseURL: BASE });
  try {
    await api.request.delete(`/v1/artifacts/${id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  } finally {
    await api.close();
  }
}

/** Open an authenticated editor session for `email` on `slug`, waiting until the canvas is live. */
async function openEditor(browser: Browser, email: string, slug: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // /auth/dev sets the session cookie and 302-redirects straight into the editor page.
  await page.goto(`/auth/dev?email=${encodeURIComponent(email)}&redirect=/a/${slug}/edit`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('#canvas-frame', { timeout: 20_000 });
  // Canvas iframe is populated client-side once the draft loads (cold renders can be slow).
  await expect(page.frameLocator('#canvas-frame').locator('#title')).toHaveText('Hello collab', { timeout: 25_000 });
  return { context, page };
}

/** Wait until `page` shows at least one remote collaborator avatar (the other user joined). */
async function waitForPeer(page: Page): Promise<void> {
  await expect(page.locator('#collaborators .collaborator-avatar').first()).toBeVisible({ timeout: 15_000 });
}

/** Enter text edit on a canvas element, type, then leave edit mode (Escape). */
async function typeInCanvas(page: Page, selector: string, text: string): Promise<void> {
  const el = page.frameLocator('#canvas-frame').locator(selector);
  await el.dblclick();
  // contenteditable focus can lag a tick after dblclick.
  await page.waitForTimeout(100);
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

test.describe('Real-time collaboration - two users', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    TOKEN = await resolveE2eToken(browser);
    test.skip(!TOKEN, 'no credentials file and no local dev worker to mint a token from');
  });

  let artifactId: string;
  let slug: string;
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeEach(async ({ browser }) => {
    // Setup (seed + two authenticated editor loads + WS connect) alone runs ~25s.
    test.setTimeout(90_000);
    ({ id: artifactId, slug } = await seedArtifact(browser));
    [{ context: ctxA, page: pageA }, { context: ctxB, page: pageB }] = await Promise.all([
      openEditor(browser, USER_A, slug),
      openEditor(browser, USER_B, slug),
    ]);
  });

  test.afterEach(async ({ browser }) => {
    await ctxA?.close();
    await ctxB?.close();
    if (artifactId) await deleteArtifact(browser, artifactId);
  });

  test('both users see each other in collaborators list', async () => {
    await waitForPeer(pageA);
    await waitForPeer(pageB);
  });

  test('user A cursor movement is visible to user B', async () => {
    await waitForPeer(pageB);

    // Cursor positions are sent on mousemove over the live canvas (.canvas, parent doc).
    const box = await pageA.locator('#canvas').boundingBox();
    expect(box).not.toBeNull();
    for (let i = 0; i < 5; i++) {
      await pageA.mouse.move(box!.x + 80 + i * 12, box!.y + 80 + i * 12);
      await pageA.waitForTimeout(60);
    }

    await expect(pageB.locator('#remote-cursors [data-cursor-user]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('element selection broadcasts a lock to the other user', async () => {
    await waitForPeer(pageB);

    // Entering edit mode on an element acquires + holds a soft lock; the other client
    // marks that element with data-locked-by inside its canvas iframe.
    await pageA.frameLocator('#canvas-frame').locator('#para').dblclick();

    const lockedB = pageB.frameLocator('#canvas-frame').locator('[data-locked-by]').first();
    await expect(lockedB).toBeVisible({ timeout: 10_000 });
    await expect(lockedB).toHaveAttribute('data-locked-by', /collab-a/);
  });

  test('a live text edit by user A propagates to user B via Yjs', async () => {
    await waitForPeer(pageB);

    // Keystrokes ride the Text CRDT over binary Yjs frames — no publish required.
    const marker = `synced-${Date.now()}`;
    await typeInCanvas(pageA, '#para', ` ${marker}`);

    await expect(pageB.frameLocator('#canvas-frame').locator('#para')).toContainText(marker, { timeout: 15_000 });
  });

  test('concurrent edits on different elements both land', async () => {
    await waitForPeer(pageB);

    // Yjs merges independent element text; there is no full-HTML conflict dialog on live edit.
    const aMarker = `fromA${Date.now()}`;
    const bMarker = `fromB${Date.now()}`;

    await Promise.all([
      typeInCanvas(pageA, '#para', ` ${aMarker}`),
      typeInCanvas(pageB, '#para2', ` ${bMarker}`),
    ]);

    await expect(pageA.frameLocator('#canvas-frame').locator('#para')).toContainText(aMarker, { timeout: 15_000 });
    await expect(pageB.frameLocator('#canvas-frame').locator('#para2')).toContainText(bMarker, { timeout: 15_000 });
    await expect(pageB.frameLocator('#canvas-frame').locator('#para')).toContainText(aMarker, { timeout: 15_000 });
    await expect(pageA.frameLocator('#canvas-frame').locator('#para2')).toContainText(bMarker, { timeout: 15_000 });
  });

  test('undo reverts the local user’s own canvas edit', async () => {
    await waitForPeer(pageB);

    const frameB = pageB.frameLocator('#canvas-frame');

    // B types on #para2; local HTML-snapshot undo should remove only that edit from B's view.
    // (Undo is still document-snapshot based, not Y.UndoManager — we only assert local reversion.)
    const bMarker = `fromB${Date.now()}`;
    await typeInCanvas(pageB, '#para2', ` ${bMarker}`);
    await expect(frameB.locator('#para2')).toContainText(bMarker, { timeout: 10_000 });

    await pageB.locator('#btn-undo').click();

    await expect(frameB.locator('#para2')).not.toContainText(bMarker, { timeout: 10_000 });
    await expect(frameB.locator('#para2')).toContainText('Second paragraph');
  });
});

test.describe('Real-time collaboration - reconnection', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    TOKEN = await resolveE2eToken(browser);
    test.skip(!TOKEN, 'no credentials file and no local dev worker to mint a token from');
  });

  test('a user reconnects and still sees the other collaborator', async ({ browser }) => {
    test.setTimeout(90_000);
    const { id, slug } = await seedArtifact(browser);
    const [{ context: ctxA, page: pageA }, { context: ctxB, page: pageB }] = await Promise.all([
      openEditor(browser, USER_A, slug),
      openEditor(browser, USER_B, slug),
    ]);
    try {
      await waitForPeer(pageB);

      // B reloads (drops and re-establishes the WebSocket); A stays connected.
      await pageB.reload({ waitUntil: 'domcontentloaded' });
      await pageB.waitForSelector('#canvas-frame', { timeout: 15_000 });
      await expect(pageB.frameLocator('#canvas-frame').locator('#title')).toHaveText('Hello collab', { timeout: 25_000 });

      // After reconnect, B sees A again and A still sees B.
      await waitForPeer(pageB);
      await waitForPeer(pageA);
    } finally {
      await ctxA.close();
      await ctxB.close();
      await deleteArtifact(browser, id);
    }
  });

  test('presence is restored after a brief network drop', async ({ browser }) => {
    test.setTimeout(90_000);
    const { id, slug } = await seedArtifact(browser);
    const [{ context: ctxA, page: pageA }, { context: ctxB, page: pageB }] = await Promise.all([
      openEditor(browser, USER_A, slug),
      openEditor(browser, USER_B, slug),
    ]);
    try {
      await waitForPeer(pageA);

      // Drop B offline briefly, then restore. The client auto-reconnects with backoff.
      await ctxB.setOffline(true);
      await pageB.waitForTimeout(1500);
      await ctxB.setOffline(false);

      // Once B reconnects, A sees a collaborator avatar again.
      await expect(pageA.locator('#collaborators .collaborator-avatar').first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await ctxA.close();
      await ctxB.close();
      await deleteArtifact(browser, id);
    }
  });
});
