import { expect, test } from '@playwright/test';
import {
  addAgentQaCollaborators,
  agentQaEmail,
  deleteAgentQaArtifact,
  openWithDevLogin,
  publishAgentQaArtifact,
  resolveE2eToken,
  waitForTextInAnyFrame,
} from './helpers/agent-qa';

let TOKEN: string | null = null;

function privateArtifactHtml(marker: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Agent QA Private Artifact</title>
</head>
<body style="font-family: system-ui, sans-serif; padding:48px; background:#f8f5ee; color:#1e2a32">
  <main style="max-width:720px; margin:0 auto; background:white; border:1px solid #e8ddce; border-radius:24px; padding:36px; box-shadow:0 20px 60px rgba(40,30,15,.10)">
    <p style="text-transform:uppercase; letter-spacing:.16em; color:#6b7f8f; font-size:12px">ShareOut private artifact</p>
    <h1>Internal agent QA access verified</h1>
    <p>This private throwaway artifact is visible through normal localhost dev auth.</p>
    <code data-e2e-marker="${marker}" style="display:block; padding:16px; background:#eef6f8; border-radius:12px">${marker}</code>
  </main>
</body>
</html>`;
}

test.describe('Internal agent QA access', () => {
  test.beforeAll(async ({ browser }) => {
    TOKEN = await resolveE2eToken(browser);
    test.skip(!TOKEN, 'no credentials file and no local dev worker to mint a token from');
  });

  test('agent can open a private artifact through localhost dev auth', async ({ browser }) => {
    test.setTimeout(90_000);

    const stamp = Date.now();
    const slug = `agent-qa-private-${stamp}`;
    const viewerEmail = agentQaEmail('agent-qa-viewer');
    const marker = `agent-qa-private-marker-${stamp}`;
    let artifactId: string | undefined;

    try {
      const artifact = await publishAgentQaArtifact(browser, TOKEN!, {
        slug,
        name: 'Agent QA Private Artifact',
        html: privateArtifactHtml(marker),
        visibility: 'private',
      });
      artifactId = artifact.id;

      await addAgentQaCollaborators(browser, TOKEN!, artifact.id, [viewerEmail], 'viewer');

      const { context, page } = await openWithDevLogin(browser, viewerEmail, `/a/${artifact.slug}/`);
      try {
        const contentFrameUrl = await waitForTextInAnyFrame(page, marker);

        expect(page.url()).toBe(`http://localhost:55162/a/${artifact.slug}/`);
        expect(contentFrameUrl).toBe(`http://localhost:55162/a/${artifact.slug}/index.html?_raw`);

        await page.screenshot({
          path: 'test-results/agent-qa-private-artifact.png',
          fullPage: true,
        });
      } finally {
        await context.close();
      }
    } finally {
      await deleteAgentQaArtifact(browser, TOKEN!, artifactId);
    }
  });
});
