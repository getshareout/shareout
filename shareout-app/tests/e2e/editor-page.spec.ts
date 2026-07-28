import { test, expect } from '@playwright/test';
import { generateEditorPage } from '../../src/editor/page/generate-editor-page';

test.describe('Editor page shell', () => {
  test('generated HTML includes canvas, chat, and bundled editor module', async ({ page }) => {
    const html = generateEditorPage({
      artifactId: 'art_e2e',
      slug: 'e2e-demo',
      theme: 'light',
    });

    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#canvas-frame')).toBeVisible();
    await expect(page.locator('#studio-rail')).toBeVisible();
    await expect(page.locator('#chat-input')).toBeVisible();
    await expect(page.locator('#btn-publish')).toBeVisible();
    await expect(page.locator('script[type="module"][src="/sdk/editor.js"]')).toHaveCount(1);
    await expect(page.locator('script')).toHaveCount(5);
  });

  test('serves editor bundle from worker', async ({ request }) => {
    const response = await request.get('/sdk/editor.js', {
      headers: { 'Sec-Fetch-Dest': 'script' },
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.text();
    expect(body.length).toBeGreaterThan(10_000);
    expect(body).toContain('EDITOR_CONFIG');
  });
});
