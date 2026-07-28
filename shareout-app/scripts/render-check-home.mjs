#!/usr/bin/env npx tsx
// Render the real home page (workspace-admin context) and parse-check every
// assembled <script> block — catches errors in interpolated sub-scripts too.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderUserHomePage } from '../src/pages/home/index.ts';

// Adversarial strings: quotes, backslash, and a literal </script> — the classic
// ways unescaped injected data breaks an inline script.
const EVIL = `O'Brien "x" \\ </script><b>`;
const card = {
  id: 'art_1', name: EVIL, slug: 'evil-1', display_slug: 'evil-1', artifact_type: 'html', visibility: 'public',
  created_at: '2026-01-01', updated_at: '2026-01-02', user_role: 'owner',
  total_views: 1, unique_visitors: 1, is_favorite: 0,
  f_blobs: 0, f_datasets: 0, f_connections: 0, f_platform: 0, f_jobs: 0, f_agent: 0,
  tags: EVIL, folder_id: 'fold_1',
};
const args = {
  user: { id: 'usr_1', email: 'admin@example.com' },
  userInfo: { name: EVIL, picture: null },
  catalog: [card], catalogTruncated: false, catalogTotal: 1,
  allCount: 1, favCount: 0, sharedCount: 0, totalViews: 1, uniqueVisitors: 1,
  recentActivity: [{ artifact_name: EVIL, slug: 'evil-1', event_type: 'view', timestamp: '2026-01-01', country: 'US' }],
  workspaces: [{ id: 'wsp_1', name: EVIL, slug: 'acme', artifact_count: 3 }],
  folders: [{ id: 'fold_1', name: EVIL, count: 1 }],
  tags: [{ label: EVIL, count: 1 }],
  search: EVIL, sort: 'recent', type: '', scope: 'all', workspace: 'wsp_1', page: 1,
  openVisDisabled: true,
  workspaceId: 'wsp_1', workspaceRole: 'admin',
  hostname: 'acme.shareout.site',
};

const res = renderUserHomePage(args);
const html = await res.text();

const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim());
const dir = mkdtempSync(join(tmpdir(), 'so-inline-'));
let errors = 0;
scripts.forEach((js, i) => {
  const file = join(dir, `home-script-${i}.js`);
  writeFileSync(file, js);
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    errors++;
    console.error(`\n✗ <script ${i}>:\n${(r.stderr || '').split('\n').slice(0, 6).join('\n')}`);
  }
});
console.log(`Checked ${scripts.length} <script> block(s); ${errors} error(s).`);
process.exit(errors ? 1 : 0);
