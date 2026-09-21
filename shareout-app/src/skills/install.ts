/**
 * Getting a workspace's skills into somebody's agent.
 *
 * The Library could already copy a body to the clipboard and build a one-file zip in
 * the browser, which covers exactly one skill, for one person, at one moment. What a
 * team using ShareOut as its skill repository actually does is re-sync: pull the
 * current set into a machine, again next week. That needs three things the app did
 * not serve — raw bytes an agent can redirect to a file, an index it can enumerate,
 * and something to run.
 *
 * Everything here hands out the normalized frontmatter from ./markdown, so what lands
 * on disk registers with an Agent Skills client instead of being an inert .md.
 */
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { json } from '../artifacts/json-response';
import { getPlatformOrigin } from '../config/origins';
import { requireWorkspaceRole } from '../workspaces/roles';
import { readSkillMarkdown } from '../skill-marketplace';
import { loadSkillGovernance, canViewSkill } from './policy';
import { skillDescription, toAgentSkillMarkdown, toSkillName } from './markdown';

/**
 * GET /v1/skills/:skillId/raw — the skill as a file, not as a JSON envelope.
 *
 * `user` may be null: official skills are instance-wide reading material and the
 * unauthenticated `.well-known/agent-skills` index links straight here, so an agent
 * can fetch one before it has a token. Everything else needs workspace membership.
 */
export async function handleGetSkillRaw(env: Env, user: AuthUser | null, skillId: string): Promise<Response> {
  const skill = await loadSkillGovernance(env, skillId);
  if (!skill || skill.blocked) return json({ error: 'Skill not found', code: 'NOT_FOUND' }, 404);
  if (!skill.official) {
    if (!user) return json({ error: 'Authentication required', code: 'UNAUTHORIZED' }, 401);
    if (!(await canViewSkill(env, user, skill))) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const md = await readSkillMarkdown(env, skillId, skill.latestVersionNo);
  if (md == null) return json({ error: 'Skill content unavailable', code: 'NOT_FOUND' }, 404);

  const summary = await skillSummary(env, skillId);
  const body = toAgentSkillMarkdown({ slug: skill.displaySlug, name: skill.name, summary }, md);
  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      // A workspace skill is workspace data behind a token — never cache it at the
      // edge. An official one is public reading material linked from the well-known
      // index, so it caches like any other static doc.
      'Cache-Control': skill.official ? 'public, max-age=300' : 'no-store',
      ...(skill.official ? { 'Access-Control-Allow-Origin': '*' } : {}),
      'X-Skill-Version': String(skill.latestVersionNo),
      'Content-Disposition': `inline; filename="${toSkillName(skill.displaySlug)}.md"`,
    },
  });
}

async function skillSummary(env: Env, artifactId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT type_metadata, description FROM artifacts WHERE id = ?')
    .bind(artifactId).first<{ type_metadata: string | null; description: string | null }>();
  try {
    const meta = row?.type_metadata ? JSON.parse(row.type_metadata) : null;
    if (typeof meta?.skill?.summary === 'string') return meta.skill.summary;
  } catch { /* fall through to the artifact description */ }
  return row?.description ?? null;
}

/**
 * GET /v1/workspaces/:workspaceId/skills/index.json
 *
 * The workspace catalog in the agentskills.io discovery shape, so a client that
 * already knows how to read `/.well-known/agent-skills/index.json` needs no new
 * parser. Authenticated, because workspace skills are workspace-visible — the
 * unauthenticated well-known index carries only the official ones.
 */
export async function handleWorkspaceSkillsIndex(
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'member');
  if (forbidden) return forbidden;

  const origin = getPlatformOrigin(env);
  const rows = await env.DB.prepare(
    `SELECT a.id, a.name, a.display_slug, a.description, a.type_metadata,
            (SELECT MAX(version_no) FROM versions v WHERE v.artifact_id = a.id) AS version_no
       FROM skill_marketplace sm
       JOIN artifacts a ON a.id = sm.artifact_id
      WHERE sm.workspace_id = ? AND sm.blocked = 0 AND a.deleted_at IS NULL
      ORDER BY sm.featured DESC, sm.score DESC, a.name ASC
      LIMIT 200`
  ).bind(workspaceId).all<{
    id: string; name: string; display_slug: string; description: string | null;
    type_metadata: string | null; version_no: number | null;
  }>();

  const skills = (rows.results ?? []).map((r) => {
    let summary: string | null = r.description;
    try {
      const meta = r.type_metadata ? JSON.parse(r.type_metadata) : null;
      if (typeof meta?.skill?.summary === 'string') summary = meta.skill.summary;
    } catch { /* keep the description */ }
    return {
      name: toSkillName(r.display_slug || r.name),
      type: 'skill-md',
      description: skillDescription(r.name, summary),
      url: `${origin}/v1/skills/${r.id}/raw`,
      version: String(r.version_no ?? 1),
      artifact_id: r.id,
    };
  });

  return json({
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    workspace_id: workspaceId,
    install: `${origin}/v1/skills/install.sh`,
    skills,
  });
}

/**
 * GET /v1/skills/install.sh — the thing you pipe to a shell.
 *
 * Public on purpose: the script carries no data, it reads the caller's own token at
 * run time and every fetch it makes is authenticated. Re-running it is the sync
 * story — files are overwritten from the current catalog.
 */
export function serveSkillInstaller(env: Env): Response {
  const origin = getPlatformOrigin(env);
  return new Response(installerScript(origin), {
    headers: {
      'Content-Type': 'text/x-shellscript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function installerScript(origin: string): string {
  return `#!/bin/sh
# ShareOut skill installer — writes a workspace's skills where your agent looks.
#
#   curl -fsSL ${origin}/v1/skills/install.sh | sh -s -- --workspace <slug-or-id>
#
# Re-run it to re-sync: existing files are overwritten from the current catalog.
#
#   --workspace <id>   workspace to install from (required)
#   --target claude    ~/.claude/skills/<name>/SKILL.md   (default)
#   --target cursor    ./.cursor/rules/<name>.mdc
#   --target dir       ./<dir>/<name>/SKILL.md, with --dir
#   --token <token>    defaults to SHAREOUT_TOKEN, else ~/.shareout/credentials
#   --list             print the catalog and exit
set -eu

ORIGIN="\${SHAREOUT_ORIGIN:-${origin}}"
TOKEN="\${SHAREOUT_TOKEN:-}"
WORKSPACE=""
TARGET="claude"
DIR=""
LIST=0

while [ $# -gt 0 ]; do
  case "$1" in
    --workspace) WORKSPACE="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --origin) ORIGIN="$2"; shift 2 ;;
    --list) LIST=1; shift ;;
    -h|--help) sed -n '2,14p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$TOKEN" ] && [ -r "$HOME/.shareout/credentials" ]; then
  TOKEN=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.shareout/credentials'))).get('token',''))" 2>/dev/null || echo "")
fi
[ -n "$TOKEN" ] || { echo "No token. Pass --token or set SHAREOUT_TOKEN." >&2; exit 1; }
[ -n "$WORKSPACE" ] || { echo "No workspace. Pass --workspace <slug-or-id>." >&2; exit 1; }

INDEX=$(curl -fsSL -H "Authorization: Bearer $TOKEN" \\
  "$ORIGIN/v1/workspaces/$WORKSPACE/skills/index.json") || {
  echo "Could not read the catalog. Check the token and the workspace." >&2; exit 1; }

if [ "$LIST" = "1" ]; then
  printf '%s' "$INDEX" | python3 -c "import json,sys
for s in json.load(sys.stdin).get('skills',[]):
    print('%-32s %s' % (s['name'], s['description'][:100]))"
  exit 0
fi

case "$TARGET" in
  claude) ROOT="$HOME/.claude/skills" ;;
  cursor) ROOT="./.cursor/rules" ;;
  dir) [ -n "$DIR" ] || { echo "--target dir needs --dir <path>" >&2; exit 2; }; ROOT="$DIR" ;;
  *) echo "unknown target: $TARGET (claude|cursor|dir)" >&2; exit 2 ;;
esac

mkdir -p "$ROOT"
COUNT=0
# name<TAB>url, one per line — no jq dependency.
printf '%s' "$INDEX" | python3 -c "import json,sys
for s in json.load(sys.stdin).get('skills',[]):
    print(s['name'] + '\\t' + s['url'])" | while IFS="$(printf '\\t')" read -r NAME URL; do
  [ -n "$NAME" ] || continue
  if [ "$TARGET" = "cursor" ]; then
    DEST="$ROOT/$NAME.mdc"
  else
    mkdir -p "$ROOT/$NAME"
    DEST="$ROOT/$NAME/SKILL.md"
  fi
  if curl -fsSL -H "Authorization: Bearer $TOKEN" "$URL" -o "$DEST.tmp"; then
    mv "$DEST.tmp" "$DEST"
    echo "  $DEST"
    COUNT=$((COUNT + 1))
  else
    rm -f "$DEST.tmp"
    echo "  ! failed: $NAME" >&2
  fi
done

echo "Done. Skills installed under $ROOT"
`;
}
