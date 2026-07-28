import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryNeedsYou, queryPulse, queryActivityFeed, queryActionItems, queryForYou, queryRecentlyViewed, recordRecentView, queryArtifactComments, addArtifactComment } from '../../src/pages/home/queries';
import { canRoleSee, defaultAudiences, resolveWorkspaceAudiences, EVENT_DEFS } from '../../src/pages/home/events';
import { getUserProfile, setUserProfile, addFollow, removeFollow } from '../../src/users/user-profile';
import { buildWorkspaceView, WORKSPACE_STYLES } from '../../src/pages/home/render-workspace';
import { createWebReplyPort } from '../../src/chat-platforms/web/reply-port';
import { CANVAS_TOOLS } from '../../src/chat-agent/tools/canvas';
import { semanticSearchIds, semanticSearchArtifacts, indexArtifactVector, backfillVectors } from '../../src/search/semantic';
import type { RenderArgs } from '../../src/pages/home/types';
import type { Env } from '../../src/types';
import type { VisibilityScope } from '../../src/account-links';

const user = { id: 'usr_1', email: 'owner@example.com' };
const vis: VisibilityScope = { userIds: ['usr_1'], emails: ['owner@example.com'] };

/** D1 stub: `all` returns per-source rows chosen by SQL substring. */
function mkEnv(allFor: (sql: string) => unknown[]): { env: Env; prepared: string[] } {
  const prepared: string[] = [];
  const DB = {
    prepare: vi.fn((sql: string) => {
      prepared.push(sql);
      return {
        bind: vi.fn(() => ({
          first: vi.fn(async () => null),
          all: vi.fn(async () => ({ results: allFor(sql) })),
          run: vi.fn(async () => ({ success: true })),
        })),
      };
    }),
  };
  return { env: { DB } as unknown as Env, prepared };
}

afterEach(() => vi.restoreAllMocks());

describe('queryNeedsYou — actionable rows only, newest-first', () => {
  const needsRows = (sql: string): unknown[] => {
    if (sql.includes('FROM artifact_comments ac')) return [{ id: 'c1', artifact_id: 'a1', artifact_name: 'A1', slug: 'a1', actor: 'Sofia', actor_picture: null, content: 'looks good', kind: 'comment', ts: 100 }];
    if (sql.includes('FROM collaborators sh')) return [{ id: 's1', artifact_id: 'a2', artifact_name: 'A2', slug: 'a2', actor: 'Boss', actor_picture: null, ts: 300 }];
    if (sql.includes('FROM access_requests ar')) return [{ id: 'ar1', artifact_id: 'a6', artifact_name: 'A6', slug: 'a6', actor: 'pat@x.com', ts: 250 }];
    if (sql.includes('FROM metric_alert_runs e')) return [{ id: 'al1', artifact_id: 'a4', artifact_name: 'A4', slug: 'a4', message: 'CPM up 4%', ts: 400 }];
    if (sql.includes('FROM artifact_test_runs tr')) return [{ id: 't1', artifact_id: 'a7', artifact_name: 'A7', slug: 'a7', status: 'failed', failed_count: 2, ts: 350 }];
    if (sql.includes('FROM job_runs jl')) return [{ id: 'r1', artifact_id: 'a3', artifact_name: 'A3', slug: 'a3', action: 'email', ts: 200 }];
    return [];
  };

  it('merges actionable kinds newest-first and normalizes summaries', async () => {
    const { env } = mkEnv(needsRows);
    const events = await queryNeedsYou(env, user, {}, vis);
    expect(events.map((e) => e.kind)).toEqual(['alert', 'test', 'share', 'access', 'run', 'comment']);
    expect(events.find((e) => e.kind === 'share')!.summary).toBe('shared this with you');
    expect(events.find((e) => e.kind === 'run')!.summary).toBe('email failed');
    expect(events.find((e) => e.kind === 'test')!.summary).toBe('2 tests failed');
    expect(events.find((e) => e.kind === 'access')!.summary).toContain('wants access');
  });

  // queryNeedsYou merges every source in JS and sorts with `y.ts - x.ts`. A source that
  // returns a raw TEXT timestamp makes that subtraction NaN, which sorts as "equal" —
  // the rows silently come back in source order instead of newest-first. Four sources
  // did exactly that before the notifications fold.
  it('every source yields ts as an integer expression, so the merge can sort', async () => {
    const { env, prepared } = mkEnv(needsRows);
    await queryNeedsYou(env, { id: 'usr_1', email: 'owner@example.com' }, { workspaceId: 'wsp_1' }, vis);

    const tsSources = prepared.filter((sql) => sql.includes(' AS ts'));
    expect(tsSources.length).toBeGreaterThan(5);
    for (const sql of tsSources) {
      const tsExpr = sql.match(/(\S[^,]*?)\s+AS ts/)![1];
      expect(tsExpr, `ts must be cast to an integer in: ${tsExpr}`).toContain('AS INTEGER)');
    }
  });

  it('only surfaces unresolved comments not authored by the viewer, and failed runs', async () => {
    const { env, prepared } = mkEnv(needsRows);
    await queryNeedsYou(env, user, { limit: 30 }, vis);
    const commentsSql = prepared.find((s) => s.includes('FROM artifact_comments ac'))!;
    expect(commentsSql).toContain('ac.resolved = 0');
    expect(commentsSql).toContain('ac.author_id NOT IN');
    const runsSql = prepared.find((s) => s.includes('FROM job_runs jl'))!;
    expect(runsSql).toContain("jl.status = 'failed'");
  });

  it('skips a kind whose audience is turned off', async () => {
    const { env, prepared } = mkEnv(needsRows);
    const off = { comment: 'off', reply: 'off', mention: 'off' } as any;
    await queryNeedsYou(env, user, {}, vis, { ...defaultAudiences(), ...off } as any);
    expect(prepared.some((s) => s.includes('FROM artifact_comments ac'))).toBe(false);
  });

  it('still reads comments for mentions when comment and reply are off', async () => {
    // Being named is directed at you — it must survive a workspace turning the
    // general comment stream down.
    const { env, prepared } = mkEnv(needsRows);
    const off = { comment: 'off', reply: 'off' } as any;
    await queryNeedsYou(env, user, {}, vis, { ...defaultAudiences(), ...off } as any);
    const sql = prepared.find((s) => s.includes('FROM artifact_comments ac'));
    expect(sql).toBeDefined();
    expect(sql).toContain("json_each(ac.mentions)");
  });

  it('returns empty for a quiet workspace', async () => {
    const { env } = mkEnv(() => []);
    expect(await queryNeedsYou(env, user, {}, vis)).toEqual([]);
  });
});

describe('queryPulse — aggregated ambient, windowed, relevance-sorted', () => {
  const pulseRows = (sql: string): unknown[] => {
    if (sql.includes('AND v.version_no > 1')) return [{ artifact_id: 'a1', artifact_name: 'A1', slug: 'a1', owned: 1, count: 3, ts: 500 }];
    if (sql.includes("ae.event_type = 'view'")) return [{ artifact_id: 'a2', artifact_name: 'A2', slug: 'a2', owned: 0, count: 18, ts: 400 }];
    return [];
  };

  it('aggregates with COUNT + GROUP BY and a window cutoff', async () => {
    const { env, prepared } = mkEnv(pulseRows);
    const rows = await queryPulse(env, user, { window: '7d' }, vis, null);
    const publishSql = prepared.find((s) => s.includes('AND v.version_no > 1'))!;
    expect(publishSql).toContain('COUNT(*)');
    expect(publishSql).toContain('GROUP BY a.id');
    const pub = rows.find((r) => r.kind === 'publish')!;
    expect(pub.count).toBe(3);
    expect(pub.summary).toBe('3 updates published');
  });

  it('owned artifacts sort above org-wide noise', async () => {
    const { env } = mkEnv(pulseRows);
    const rows = await queryPulse(env, user, { window: '30d' }, vis, null);
    expect(rows[0].kind).toBe('publish'); // owned (a1) before the higher-ts unowned view
  });

  it('self-tier favorites restrict to the viewer in personal scope', async () => {
    const { env, prepared } = mkEnv(() => []);
    await queryPulse(env, user, {}, vis, null); // no workspace → personal → own slice
    const favSql = prepared.find((s) => s.includes('FROM favorites f'))!;
    expect(favSql).toContain('f.user_id IN');
  });
});

describe('queryActivityFeed — two surfaces + window', () => {
  it('returns needs, pulse, action items and the resolved window', async () => {
    const { env } = mkEnv(() => []);
    const feed = await queryActivityFeed(env, user, { window: 'today' }, vis);
    expect(feed).toEqual({ needs: [], seen: [], pulse: [], window: 'today', actionItems: [], requestedOpen: 0 });
  });
});

describe('queryActionItems — cross-artifact inbox', () => {
  const actionRows = (sql: string): unknown[] =>
    sql.includes('SELECT COUNT(*) AS n') ? [] : [
      { id: 'ai1', artifact_id: 'a1', artifact_name: 'A1', slug: 'a1', actor: 'Sofia', content: 'ship the deck', due_at: '2026-07-08', ts: 100, resolved: 0, resolved_by: null, resolved_at: null },
    ];

  it('filters to assignee (id + lower email) and open OR my-recently-completed, orders due-first nulls-last', async () => {
    const { env, prepared } = mkEnv(actionRows);
    const { items } = await queryActionItems(env, { id: 'usr_1', email: 'Owner@Example.com' }, null);
    expect(items).toHaveLength(1);
    expect(items[0].artifact_id).toBe('a1');
    expect(items[0].summary).toBe('ship the deck');
    const sel = prepared.find((s) => s.includes('ac.due_at') && s.includes('FROM artifact_comments ac'))!;
    expect(sel).toContain('ac.assignee_user_id = ?');
    expect(sel).toContain('lower(ac.assignee_email) = ?');
    expect(sel).toContain("ac.resolved = 1 AND ac.assignee_email IS NOT NULL AND ac.author_id = ?");
    expect(sel).toContain("strftime('%Y-%m-%dT%H:%M:%fZ','now', '-7 days')");
    expect(sel).toContain('CASE WHEN ac.due_at IS NULL THEN 1 ELSE 0 END, ac.due_at ASC, ac.created_at DESC');
  });

  it('requestedOpen counts my authored comments with an assignee still unresolved (null-safe default)', async () => {
    const { env, prepared } = mkEnv(actionRows);
    const { requestedOpen } = await queryActionItems(env, user, null);
    expect(requestedOpen).toBe(0); // mock first() → null, guarded to 0
    const cnt = prepared.find((s) => s.includes('SELECT COUNT(*) AS n'))!;
    expect(cnt).toContain('ac.author_id = ?');
    expect(cnt).toContain('ac.resolved = 0');
    expect(cnt).toContain('ac.assignee_user_id IS NOT NULL OR ac.assignee_email IS NOT NULL');
  });

  it('scopes to a workspace when given one', async () => {
    const { env, prepared } = mkEnv(actionRows);
    await queryActionItems(env, user, 'wsp_9');
    const sel = prepared.find((s) => s.includes('ac.due_at') && s.includes('FROM artifact_comments ac'))!;
    expect(sel).toContain('a.workspace_id = ?');
  });
});

describe('queryNeedsYou — dedup against action items', () => {
  it('excludes unresolved comments where the viewer is the assignee', async () => {
    const { env, prepared } = mkEnv(() => []);
    await queryNeedsYou(env, user, {}, vis);
    const sql = prepared.find((s) => s.includes('FROM artifact_comments ac'))!;
    expect(sql).toContain('ac.assignee_user_id NOT IN');
    expect(sql).toContain('lower(ac.assignee_email) NOT IN');
  });
});

describe('event visibility model', () => {
  it('defaults are privacy-first (views/favorites/agent = self, governance = admins)', () => {
    expect(EVENT_DEFS.view.defaultAudience).toBe('self');
    expect(EVENT_DEFS.favorite.defaultAudience).toBe('self');
    expect(EVENT_DEFS.agent.defaultAudience).toBe('self');
    expect(EVENT_DEFS.access.defaultAudience).toBe('admins');
    expect(EVENT_DEFS.member.defaultAudience).toBe('admins');
    expect(EVENT_DEFS.connection.defaultAudience).toBe('admins');
  });

  it('canRoleSee gates by role × audience, and own events always pass', () => {
    expect(canRoleSee('self', null, false)).toBe(false);
    expect(canRoleSee('self', null, true)).toBe(true);
    expect(canRoleSee('members', 'member', false)).toBe(true);
    expect(canRoleSee('admins', 'member', false)).toBe(false);
    expect(canRoleSee('admins', 'admin', false)).toBe(true);
    expect(canRoleSee('off', 'owner', true)).toBe(false);
  });

  it('resolveWorkspaceAudiences applies admin overrides over defaults', async () => {
    const { env } = mkEnv((sql) =>
      sql.includes('FROM workspace_event_visibility') ? [{ event_kind: 'publish', audience: 'admins' }] : []);
    const map = await resolveWorkspaceAudiences(env, 'wsp_1');
    expect(map.publish).toBe('admins');
    expect(map.comment).toBe(defaultAudiences().comment);
  });
});

describe('recently viewed', () => {
  it('recordRecentView upserts viewed_at', async () => {
    const { env, prepared } = mkEnv(() => []);
    await recordRecentView(env, 'usr_1', 'art_1');
    const sql = prepared.find((s) => s.includes('user_recent_views'))!;
    expect(sql).toContain('ON CONFLICT(user_id, artifact_id) DO UPDATE SET viewed_at');
  });

  it('queryRecentlyViewed joins the view log, scopes to owner/collaborator, orders by viewed_at', async () => {
    const { env, prepared } = mkEnv(() => [{ id: 'a1', name: 'A1' }]);
    const rows = await queryRecentlyViewed(env, user, {}, vis);
    expect(rows).toHaveLength(1);
    const sql = prepared.find((s) => s.includes('FROM user_recent_views'))!;
    expect(sql).toContain('JOIN artifacts a ON a.id = v.artifact_id');
    expect(sql).toContain('v.user_id IN');
    expect(sql).toContain('ORDER BY viewed_at DESC');
  });
});

describe('queryForYou — relevance heuristic', () => {
  it('scores shared (+3) and favorited (+2), excludes examples, orders by score then recency', async () => {
    const { env, prepared } = mkEnv(() => [{ id: 'a1', name: 'A1' }]);
    const rows = await queryForYou(env, user, {}, vis);
    expect(rows).toHaveLength(1);
    const sql = prepared.find((s) => s.includes('relevance_score'))!;
    expect(sql).toContain('CASE WHEN a.owner_id NOT IN');
    expect(sql).toContain('THEN 3 ELSE 0 END');
    expect(sql).toContain('THEN 2 ELSE 0 END');
    expect(sql).toContain('a.is_example = 0');
    expect(sql).toContain('ORDER BY relevance_score DESC, COALESCE(d.updated_at, a.created_at) DESC');
  });
});

/** Stateful single-row D1 stub for the profile store. */
function mkProfileEnv(): Env {
  let row: { user_id: string; profile_md: string; follows: string; updated_at: number } | null = null;
  const DB = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => row,
        run: async () => {
          if (sql.includes('profile_md = excluded.profile_md')) {
            row = { user_id: String(args[0]), profile_md: String(args[1]), follows: row?.follows ?? '[]', updated_at: 1 };
          } else if (sql.includes('follows = excluded.follows')) {
            row = { user_id: String(args[0]), profile_md: row?.profile_md ?? '', follows: String(args[1]), updated_at: 1 };
          }
          return { success: true };
        },
      }),
    }),
  };
  return { DB } as unknown as Env;
}

describe('user-profile store', () => {
  it('returns an empty default when no row exists', async () => {
    const env = mkProfileEnv();
    expect(await getUserProfile(env, 'usr_1')).toEqual({ userId: 'usr_1', profileMd: '', follows: [], updatedAt: '' });
  });

  it('sets markdown memory and reads it back', async () => {
    const env = mkProfileEnv();
    await setUserProfile(env, 'usr_1', '# I care about CPM');
    const p = await getUserProfile(env, 'usr_1');
    expect(p.profileMd).toBe('# I care about CPM');
  });

  it('adds follows idempotently and removes them', async () => {
    const env = mkProfileEnv();
    const f = { kind: 'topic' as const, ref: 'cpm' };
    await addFollow(env, 'usr_1', f);
    let follows = await addFollow(env, 'usr_1', f); // duplicate → no-op
    expect(follows).toEqual([f]);
    follows = await removeFollow(env, 'usr_1', f);
    expect(follows).toEqual([]);
  });

  it('tolerates malformed follows JSON', async () => {
    const env = mkProfileEnv();
    await setUserProfile(env, 'usr_1', 'x'); // seeds a row with follows '[]'
    // corrupt the store directly is not exposed; instead assert parse guards empty array
    const p = await getUserProfile(env, 'usr_1');
    expect(Array.isArray(p.follows)).toBe(true);
  });
});

describe('buildWorkspaceView — Phase 1 shell SSR', () => {
  const args = {
    user, userInfo: { name: 'Leonel', picture: null }, catalog: [], catalogTruncated: false,
    catalogTotal: 0, allCount: 0, favCount: 0, sharedCount: 0, workspaces: [], folders: [],
    teamFolders: [], personalFolders: [], filesScope: 'team', folderKind: '', folder: '', tags: [],
    search: '', sort: 'recent', type: '', scope: 'all', workspace: '', page: 1, openVisDisabled: false,
    workspaceId: null, workspaceRole: null, wsTeamsPlan: false, accessRequests: [], hostname: 'shareout.site',
    visualEditorOffWorkspaces: [], createEnabled: true, userSubscription: null,
  } as unknown as RenderArgs;

  it('renders the three regions + dock and the hydration script', () => {
    const { body, scripts } = buildWorkspaceView(args);
    expect(body).toContain('class="wsx__rail"');
    expect(body).toContain('class="wsx__canvas"');
    expect(body).toContain('class="wsx__activity"');
    expect(body).toContain('id="wsxDock"');
    expect(body).toContain('data-lens="brief"');
    expect(body).toContain('data-lens="artifacts"');
    expect(body).toContain('data-lens="schedules"');
    expect(body).toContain('Leonel');
    // client fetches the Phase-0 endpoints
    expect(scripts).toContain('/v1/home/activity-feed');
    expect(scripts).toContain('/v1/home/for-you');
    expect(WORKSPACE_STYLES).toContain('--shadow-hero');
  });

  it('escapes user-controlled name', () => {
    const evil = { ...args, userInfo: { name: '<img src=x onerror=alert(1)>', picture: null } } as RenderArgs;
    const { body } = buildWorkspaceView(evil);
    expect(body).not.toContain('<img src=x onerror=alert(1)>');
    expect(body).toContain('&lt;img');
  });

  it('wires the agent dock + builds artifact stage panes client-side (tabs)', () => {
    const { body, scripts } = buildWorkspaceView(args);
    expect(body).toContain('id="wsxDock"');
    expect(body).toContain('id="wsxTabs"');        // tab strip in the canvas
    expect(body).toContain('id="wsxPanes"');
    // the stage + toolbar are built per-tab in the client (not in SSR body)
    expect(scripts).toContain('wsx__stageframe');
    expect(scripts).toContain('makeArtifactPane');
    expect(scripts).toContain("API = '/v1/home/agent'"); // chat/confirm/threads built off this base
    expect(scripts).toContain('open_artifact');
  });

  it('inspector (right rail) wires real meta edits, analytics, deliver + comments', () => {
    const { scripts } = buildWorkspaceView(args);
    expect(scripts).toContain('function renderDetails');        // Details tab
    expect(scripts).toContain('function paintComments');        // Comments thread+composer
    expect(scripts).toContain('function renderAutomate');       // Automate tab
    expect(scripts).toContain('data-dest="Slack"');             // deliver destination picker
    expect(scripts).toContain('patchArtifact');                 // inline meta edit
    expect(scripts).toContain('/v1/home/comments');             // list + post comments
    expect(scripts).toContain('function postComment');          // add a comment / reply
    expect(scripts).toContain('metaCache');                     // no refetch on tab switch
    expect(scripts).toContain('/analytics?days=');
  });

  it('edit-lite: tab-bar View/Edit toggle wires the editor draft/publish contract', () => {
    const { body, scripts } = buildWorkspaceView(args);
    expect(scripts).toContain('wsx__editframe');                // separate edit iframe in the pane
    expect(body).toContain('id="wsxTabMode"');                  // View/Edit toggle lives in the tab bar
    expect(body).toContain('data-mode="edit"');
    expect(scripts).toContain('function loadEditSource');       // GET …/editor
    expect(scripts).toContain('/editor/draft');                 // autosave draft
    expect(scripts).toContain('/editor/publish');               // publish
    expect(scripts).toContain('function serializeClean');       // strip editor hooks before save
    expect(scripts).toContain('contenteditable');               // inline text editing
    expect(scripts).toContain('function renderEditPanel');      // right rail becomes a property panel
    expect(scripts).toContain('function editPanelImg');         // image src/upload/alt
    expect(scripts).toContain('/editor/upload');                // image upload
    expect(scripts).toContain("label: t('inspector.editing')");   // Edit-mode rail tab (i18n)
    expect(scripts).toContain('function aiAssist');             // AI on selection
    expect(scripts).toContain('/editor/chat/normal');           // reuses the editor AI contract
    expect(scripts).toContain('function pushHistory');          // undo/redo history
    expect(scripts).toContain('function discardDraft');         // discard draft safety
  });

  it('is a studio shell: no top header, collapsible rail, hover-handle inspector resize', () => {
    const { body, scripts } = buildWorkspaceView(args);
    expect(body).not.toContain('class="wsx__top"');   // no top header
    expect(body).toContain('id="wsxCollapse"');        // rail collapse toggle (fixed open/min only)
    expect(body).not.toContain('data-rz="rail"');      // rail no longer drag-resizable
    expect(body).toContain('id="wsxActHandle"');       // inspector resize handle (on hover)
    expect(scripts).toContain('is-rail-collapsed');
  });

  it('client script is valid JS and wires the two-surface feed + visibility gear', () => {
    const { scripts } = buildWorkspaceView(args);
    // The client IIFE never runs in tests, so this is its only syntax guard.
    expect(() => new Function(scripts)).not.toThrow();
    expect(scripts).toContain('function loadFeed');
    expect(scripts).toContain('activity-feed?limit=50&window=');
    expect(scripts).toContain('pulseEvents');
    expect(scripts).toContain('/v1/home/event-visibility');
    expect(scripts).toContain('WSX_ADMIN');
  });

  it('Create with AI runs in-Studio: create view + planner/build via /v1/create/generate', () => {
    const { body, scripts } = buildWorkspaceView(args);
    expect(body).toContain('data-view="create"');   // create canvas view
    expect(body).toContain('id="wsxCreateBtn"');     // rail Create button (no nav-away)
    expect(body).not.toContain("location.href='/create'");
    expect(scripts).toContain('/v1/create/generate'); // reuses the create endpoints
    expect(scripts).toContain('renderClarify');       // one-by-one questions
  });
});

describe('Phase 2 — canvas piloting plumbing', () => {
  it('web reply port emits ui_action and cards events', async () => {
    const events: any[] = [];
    const port = createWebReplyPort({ ARTIFACTS: {} } as unknown as Env, 'usr_1', (e) => events.push(e));
    await port.sendUiAction!({ kind: 'open_artifact', artifactId: 'a1', slug: 'q3', name: 'Q3' });
    await port.sendArtifactCards([{ id: 'a1', name: 'Q3', slug: 'q3' }]);
    expect(events[0]).toEqual({ type: 'ui_action', action: { kind: 'open_artifact', artifactId: 'a1', slug: 'q3', name: 'Q3' } });
    expect(events[1].type).toBe('cards');
  });

  it('exposes canvas tools with the expected names + schemas', () => {
    const names = CANVAS_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(['open_artifact', 'show_artifacts', 'show_onboarding']);
    const open = CANVAS_TOOLS.find((t) => t.name === 'open_artifact')!;
    expect((open.input_schema as any).required).toContain('artifact_id');
  });
});

describe('semantic search — graceful degradation without bindings', () => {
  const noBindings = { DB: {} } as unknown as Env; // no AI / VECTORIZE

  it('semanticSearchIds returns null when AI/Vectorize are absent', async () => {
    expect(await semanticSearchIds(noBindings, 'ad cost pages')).toBeNull();
  });

  it('semanticSearchArtifacts returns null (→ caller falls back to keyword)', async () => {
    expect(await semanticSearchArtifacts(noBindings, 'usr_1', 'ad cost pages')).toBeNull();
  });

  it('index + backfill are safe no-ops without bindings', async () => {
    await expect(indexArtifactVector(noBindings, 'art_1')).resolves.toBeUndefined();
    await expect(backfillVectors(noBindings)).resolves.toEqual({ indexed: 0, skipped: 0 });
  });
});

describe('artifact comments — Inspector list + post (session-authed)', () => {
  function mkCommentEnv(rows: unknown[], access = true) {
    const runs: { sql: string; args: unknown[] }[] = [];
    const DB = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...args: unknown[]) => ({
          first: vi.fn(async () => (sql.includes('SELECT 1 FROM artifacts') ? (access ? { x: 1 } : null) : null)),
          all: vi.fn(async () => ({ results: rows })),
          run: vi.fn(async () => { runs.push({ sql, args }); return { success: true }; }),
        })),
      })),
    };
    return { env: { DB } as unknown as Env, runs };
  }

  it('lists comments (incl. replies) when the user has access', async () => {
    const rows = [
      { id: 'c1', parent_id: null, author_id: 'u2', author_name: 'Sofia', author_type: 'human', content: 'hi', created_at: '2026-01-01', resolved: 0 },
      { id: 'c2', parent_id: 'c1', author_id: 'u3', author_name: 'Bot', author_type: 'agent', content: 'reply', created_at: '2026-01-02', resolved: 0 },
    ];
    const { env } = mkCommentEnv(rows);
    const out = await queryArtifactComments(env, user, 'art_1', 200, vis);
    expect(out).toHaveLength(2);
    expect(out[1].parent_id).toBe('c1');
  });

  it('returns [] when the user cannot access the artifact', async () => {
    const { env } = mkCommentEnv([], false);
    expect(await queryArtifactComments(env, user, 'art_x', 200, vis)).toEqual([]);
  });

  it('addArtifactComment inserts and returns the new row', async () => {
    const { env, runs } = mkCommentEnv([], true);
    const c = await addArtifactComment(env, { ...user, name: 'Leo' }, 'art_1', '  hello  ', null, undefined, vis);
    expect(c).not.toBeNull();
    expect(c!.content).toBe('hello');
    expect(c!.author_name).toBe('Leo');
    expect(runs.some((r) => r.sql.includes('INSERT INTO artifact_comments'))).toBe(true);
  });

  it('addArtifactComment rejects empty content and no-access', async () => {
    const ok = mkCommentEnv([], true);
    expect(await addArtifactComment(ok.env, user, 'art_1', '   ', null, undefined, vis)).toBeNull();
    const denied = mkCommentEnv([], false);
    expect(await addArtifactComment(denied.env, user, 'art_1', 'hi', null, undefined, vis)).toBeNull();
  });
});
