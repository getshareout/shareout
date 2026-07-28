// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_CLIENT } from '../../../src/pages/home/render-workspace/client-script/index';
import adminTs from '../../../src/pages/home/render-workspace/client-script/home-views/admin.ts?raw';
import clientsTs from '../../../src/pages/home/render-workspace/client-script/home-views/clients.ts?raw';
import artifactsBrowserTs from '../../../src/pages/home/render-workspace/client-script/home-views/artifacts-browser.ts?raw';
import cardActionsTs from '../../../src/pages/home/render-workspace/client-script/home-views/card-actions.ts?raw';
import schedulesTs from '../../../src/pages/home/render-workspace/client-script/home-views/schedules.ts?raw';
import analyticsTs from '../../../src/pages/home/render-workspace/client-script/home-views/analytics.ts?raw';
import datasetsTs from '../../../src/pages/home/render-workspace/client-script/home-views/datasets.ts?raw';
import crewTs from '../../../src/pages/home/render-workspace/client-script/home-views/crew.ts?raw';
import libraryTs from '../../../src/pages/home/render-workspace/client-script/home-views/library.ts?raw';
import connectorsTs from '../../../src/pages/home/render-workspace/client-script/home-views/connectors.ts?raw';
import modalsFormsTs from '../../../src/pages/home/render-workspace/client-script/home-views/modals-forms.ts?raw';
import assetsTs from '../../../src/pages/home/render-workspace/client-script/home-views/assets.ts?raw';
import deliveriesTs from '../../../src/pages/home/render-workspace/client-script/home-views/deliveries.ts?raw';
import lensRoutingTs from '../../../src/pages/home/render-workspace/client-script/home-views/lens-routing.ts?raw';
import homeViewsBarrel from '../../../src/pages/home/render-workspace/client-script/home-views.ts?raw';

/** Captured at split time — guards against accidental client-script drift.
 *  Re-pinned after comments file-thread UX + invite copy-link on main. */
const ORIGINAL_WORKSPACE_CLIENT_LENGTH = 554_301;
const ORIGINAL_WORKSPACE_CLIENT_SHA256 = 'f1a00a5355e9c82972b9ed64179c6a2914595585920dc3446922a9103170fbdf';
const HOME_VIEWS_MARKER = '  // ===== rail nav → Home pane views =====';

const SECTION_SOURCES: [string, string][] = [
  ['artifacts-browser', artifactsBrowserTs],
  ['card-actions', cardActionsTs],
  ['schedules', schedulesTs],
  ['analytics', analyticsTs],
  ['datasets', datasetsTs],
  ['crew', crewTs],
  ['library', libraryTs],
  ['connectors', connectorsTs],
  ['modals-forms', modalsFormsTs],
  ['admin', adminTs],
  ['clients', clientsTs],
  ['assets', assetsTs],
  ['deliveries', deliveriesTs],
  ['lens-routing', lensRoutingTs],
];

async function sha256(text: string): Promise<string> {
  return createHash('sha256').update(text).digest('hex');
}

function extractHomeViewsFromWorkspaceClient(): string {
  const start = WORKSPACE_CLIENT.indexOf(HOME_VIEWS_MARKER);
  expect(start, 'home-views marker in WORKSPACE_CLIENT').toBeGreaterThan(0);
  return WORKSPACE_CLIENT.slice(start);
}

describe('home views client script', () => {
  it('keeps the legacy barrel and largest section under 1000 lines', () => {
    expect(homeViewsBarrel.split('\n').length).toBeLessThanOrEqual(20);
    for (const [name, src] of SECTION_SOURCES) {
      const lines = src.split('\n').length;
      expect(lines, `${name}.ts has ${lines} lines`).toBeLessThanOrEqual(1000);
    }
  });

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

  it('preserves the full workspace client bundle byte-for-byte', async () => {
    expect(WORKSPACE_CLIENT.length).toBe(ORIGINAL_WORKSPACE_CLIENT_LENGTH);
    expect(await sha256(WORKSPACE_CLIENT)).toBe(ORIGINAL_WORKSPACE_CLIENT_SHA256);
    expect(() => new Function(WORKSPACE_CLIENT)).not.toThrow();
  });

  it('lists all expected section slugs', () => {
    expect(SECTION_SOURCES.map(([name]) => name)).toEqual([
      'artifacts-browser',
      'card-actions',
      'schedules',
      'analytics',
      'datasets',
      'crew',
      'library',
      'connectors',
      'modals-forms',
      'admin',
      'clients',
      'assets',
      'deliveries',
      'lens-routing',
    ]);
  });
});
