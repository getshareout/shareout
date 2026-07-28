// Starter kit — pre-loaded example artifacts so no account or workspace ever
// opens to an empty home. Seeded in the background (waitUntil) when a new account
// is created (personal kit) or a new team workspace is created (team kit). Each
// example is a self-contained HTML artifact that demonstrates and explains one
// ShareOut feature. Re-seeding is idempotent: publishArtifact dedupes on
// (display_slug, owner), so the same caller never gets duplicates.
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { rewriteSkillOrigin } from '../skill-origin';
import { publishArtifact } from '../publish';
import { generateId } from '../crypto-utils';
import type { StarterArtifact } from './types';

export const EXAMPLES_FOLDER_SLUG = 'examples';
export const EXAMPLES_FOLDER_NAME = 'Examples';

// Find-or-create the "Examples" folder the kit lives in, so the seeded artifacts
// group together and stay out of the way of the user's own work. Scoped to the
// personal space (workspace_id NULL) or the team workspace. Idempotent.
async function ensureExamplesFolder(env: Env, user: AuthUser, workspaceId: string | null): Promise<string | null> {
  try {
    const existing = workspaceId
      ? await env.DB.prepare(
          "SELECT id FROM folders WHERE workspace_id = ? AND parent_id IS NULL AND slug = ?"
        ).bind(workspaceId, EXAMPLES_FOLDER_SLUG).first<{ id: string }>()
      : await env.DB.prepare(
          "SELECT id FROM folders WHERE workspace_id IS NULL AND owner_id = ? AND parent_id IS NULL AND slug = ?"
        ).bind(user.id, EXAMPLES_FOLDER_SLUG).first<{ id: string }>();
    if (existing) return existing.id;

    const folderId = generateId('fld');
    await env.DB.prepare(`
      INSERT INTO folders (id, workspace_id, owner_id, name, slug, parent_id, visibility, created_by)
      VALUES (?, ?, ?, ?, ?, NULL, 'inherit', ?)
    `).bind(folderId, workspaceId, user.id, EXAMPLES_FOLDER_NAME, EXAMPLES_FOLDER_SLUG, user.id).run();
    return folderId;
  } catch {
    // Lost a race or folders unavailable — fall back to seeding at top level.
    return null;
  }
}

import { startHere } from './artifacts/start-here';
import { visitorCounter } from './artifacts/visitor-counter';
import { feedbackWall } from './artifacts/feedback-wall';
import { kanbanBoard } from './artifacts/kanban-board';
import { livePoll } from './artifacts/live-poll';
import { kpiDashboard } from './artifacts/kpi-dashboard';
import { imageGallery } from './artifacts/image-gallery';
import { collabNotes } from './artifacts/collab-notes';
import { commentablePage } from './artifacts/commentable-page';
import { askAi } from './artifacts/ask-ai';
import { sharedTable } from './artifacts/shared-table';
import { teamDashboard } from './artifacts/team-dashboard';
import { liveConnector } from './artifacts/live-connector';
import { publishApprovals } from './artifacts/publish-approvals';
import { workspaceAssistant } from './artifacts/workspace-assistant';

export const PERSONAL_KIT: StarterArtifact[] = [
  startHere,
  visitorCounter,
  feedbackWall,
  kanbanBoard,
  livePoll,
  kpiDashboard,
  imageGallery,
  collabNotes,
  commentablePage,
  askAi,
];

// Extra examples that only make sense inside a team/enterprise workspace.
export const TEAM_KIT: StarterArtifact[] = [
  sharedTable,
  teamDashboard,
  liveConnector,
  publishApprovals,
  workspaceAssistant,
];

export interface SeedResult {
  seeded: string[];
  failed: { slug: string; error: string }[];
}

interface SeedOptions {
  /** null = personal space; a wsp_* id = team workspace. */
  workspaceId: string | null;
  /** 'personal' seeds PERSONAL_KIT; 'team' seeds PERSONAL_KIT + TEAM_KIT. */
  tier: 'personal' | 'team';
}

async function seedOne(
  env: Env,
  user: AuthUser,
  art: StarterArtifact,
  workspaceId: string | null,
  folderId: string | null,
): Promise<void> {
  const visibility = art.visibility ?? (workspaceId ? 'workspace' : 'private');
  await publishArtifact(env, user, {
    name: art.name,
    slug: art.slug,
    entrypoint: 'index.html',
    // The example HTML is a module constant, so it carries the founder SDK URL.
    // Rewrite it to this instance at the one point every example flows through —
    // otherwise every new account on a self-hosted instance opens to examples that
    // fetch their SDK from someone else's server.
    files: [{ path: 'index.html', content: rewriteSkillOrigin(art.html, env), mime: 'text/html', encoding: 'utf8' }],
    visibility,
    authMethod: 'google',
    shareWith: [],
    credentials: [],
    workspaceId,
    folderId,
    artifactType: 'html',
    agent: art.agent,
    isExample: true,
  } as Parameters<typeof publishArtifact>[2]);
}

/**
 * Publish the appropriate kit into a fresh home. Per-artifact failures are
 * isolated — one bad publish never aborts the rest — so a new user always lands
 * on a populated home even if a single example trips.
 */
export async function seedStarterKit(
  env: Env,
  user: AuthUser,
  opts: SeedOptions,
): Promise<SeedResult> {
  const kit = opts.tier === 'team' ? [...PERSONAL_KIT, ...TEAM_KIT] : PERSONAL_KIT;
  const result: SeedResult = { seeded: [], failed: [] };
  const folderId = await ensureExamplesFolder(env, user, opts.workspaceId);
  for (const art of kit) {
    try {
      await seedOne(env, user, art, opts.workspaceId, folderId);
      result.seeded.push(art.slug);
    } catch (e) {
      result.failed.push({ slug: art.slug, error: (e as Error).message || 'unknown' });
    }
  }
  return result;
}

/**
 * Fire-and-forget seeding for signup / workspace-create paths. Runs past the
 * response via waitUntil when an ExecutionContext is available, so the user is
 * redirected immediately and the kit fills in within seconds. Never throws into
 * the caller — a seeding hiccup must not block account or workspace creation.
 */
export function scheduleSeedStarterKit(
  env: Env,
  user: AuthUser,
  opts: SeedOptions,
  executionCtx?: ExecutionContext,
): void {
  // Seeding runs past the response — it requires a waitUntil context. The Worker
  // fetch handler always supplies one; absence means a direct/unit-test call, so
  // we skip rather than block the caller with 10-15 inline publishes.
  if (!executionCtx?.waitUntil) return;
  const run = seedStarterKit(env, user, opts)
    .then((r) => {
      if (r.failed.length) {
        console.warn('starter-kit seed partial', user.id, opts.tier, r.failed);
      }
    })
    .catch((e) => console.error('starter-kit seed failed', user.id, e));
  executionCtx.waitUntil(run);
}
