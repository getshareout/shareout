// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { WORKSPACE_CLIENT } from '../../../src/pages/home/render-workspace/client-script/index';
import modalsFormsTs from '../../../src/pages/home/render-workspace/client-script/home-views/modals-forms.ts?raw';

const HOME_VIEWS_MARKER = '  // ===== rail nav → Home pane views =====';

function extractHomeViewsFromWorkspaceClient(): string {
  const start = WORKSPACE_CLIENT.indexOf(HOME_VIEWS_MARKER);
  expect(start, 'home-views marker in WORKSPACE_CLIENT').toBeGreaterThan(0);
  return WORKSPACE_CLIENT.slice(start);
}

describe('home views client script', () => {
  it('includes signature home-pane lenses and admin helpers', () => {
    const homeViews = extractHomeViewsFromWorkspaceClient();
    expect(homeViews).toContain('loadArtifacts');
    expect(homeViews).toContain('loadSchedules');
    expect(homeViews).toContain('loadAdmin');
    expect(homeViews).toContain('openView');
    expect(homeViews).toContain('wsxModal');
  });

  it('handles workspace OAuth connection errors in the connect modal', () => {
    expect(modalsFormsTs).toContain('shareout:workspace:connection:error');
    expect(modalsFormsTs).toContain('shareout:platform:connection:error');
    expect(modalsFormsTs).toContain("t('modal.oauthFailed')");
    expect(modalsFormsTs).toContain('ev.data.message');
  });
});
