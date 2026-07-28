import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { renderSlidesAnalyticsPage } from '../../../src/pages/slides-analytics';
import type { Env } from '../../../src/types';

const e = env as unknown as Env;
const OWNER = { id: 'usr_owner', email: 'owner@x.com' };
const STRANGER = { id: 'usr_x', email: 'stranger@x.com' };
const ART = 'art_deck';

beforeAll(async () => {
  for (const s of [
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS collaborators (artifact_id TEXT, email TEXT, role TEXT)`,
    `CREATE TABLE IF NOT EXISTS presentations (id TEXT PRIMARY KEY, artifact_id TEXT, title TEXT, created_at TEXT)`,
  ]) await e.DB.prepare(s).run();
});

beforeEach(async () => {
  for (const t of ['artifacts', 'collaborators', 'presentations']) await e.DB.prepare(`DELETE FROM ${t}`).run();
  await e.DB.prepare(`INSERT INTO artifacts (id, name, owner_id) VALUES (?, 'my-deck', 'usr_owner')`).bind(ART).run();
});

function reqFor(art: string): Request {
  return new Request(`https://shareout.site/app/slides/${art}/analytics`);
}

describe('slides analytics dashboard page', () => {
  it('403s for a non-owner non-collaborator', async () => {
    const res = await renderSlidesAnalyticsPage(reqFor(ART), e, STRANGER, ART);
    expect(res.status).toBe(403);
  });

  it('renders for the owner with the deck title and dashboard sections', async () => {
    await e.DB.prepare(`INSERT INTO presentations (id, artifact_id, title, created_at) VALUES ('pres_1', ?, 'Q3 Proposal', '2026-01-01')`).bind(ART).run();
    const res = await renderSlidesAnalyticsPage(reqFor(ART), e, OWNER, ART);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Q3 Proposal');
    expect(html).toContain('sa-summary');
    expect(html).toContain('Tracked links');
    expect(html).toContain('/v1/data/art_deck/slides/pres_1');
  });

  it('allows a non-viewer collaborator', async () => {
    await e.DB.prepare(`INSERT INTO collaborators (artifact_id, email, role) VALUES (?, 'stranger@x.com', 'editor')`).bind(ART).run();
    const res = await renderSlidesAnalyticsPage(reqFor(ART), e, STRANGER, ART);
    expect(res.status).toBe(200);
  });

  it('blocks a viewer-role collaborator', async () => {
    await e.DB.prepare(`INSERT INTO collaborators (artifact_id, email, role) VALUES (?, 'stranger@x.com', 'viewer')`).bind(ART).run();
    const res = await renderSlidesAnalyticsPage(reqFor(ART), e, STRANGER, ART);
    expect(res.status).toBe(403);
  });

  it('shows an empty state when the artifact has no presentation', async () => {
    const res = await renderSlidesAnalyticsPage(reqFor(ART), e, OWNER, ART);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('no presentation yet');
  });

  it('404-style forbidden for an unknown artifact', async () => {
    const res = await renderSlidesAnalyticsPage(reqFor('art_missing'), e, OWNER, 'art_missing');
    expect(res.status).toBe(403);
  });
});
