-- Why: a workspace skill is the team's source of truth, but only its original author
-- could ever change it — editing an artifact requires owner or an explicit per-email
-- collaborator row, and a workspace admin deliberately gets no content write
-- (src/artifacts/roles.ts). So the common cases had no answer: a shared playbook the
-- whole team should keep current, and a skill whose author left. The only escape was
-- transferring the artifact.
--
-- edit_policy is that answer, per skill: 'owner_only' keeps today's rule, 'workspace'
-- lets any member republish it, and 'approval' lets any member PROPOSE a change that
-- an approver merges. workspaces.default_skill_edit_policy is what a newly published
-- skill starts as, so an admin sets the house rule once.
--
-- skill_change_requests holds the proposed markdown inline: skill bodies are budgeted
-- at 60k chars by the agent loader, so a TEXT column is both sufficient and the only
-- place the proposal exists before it is merged (a merge republishes the artifact,
-- which is what creates the new version and its R2 assets).

ALTER TABLE skill_marketplace ADD COLUMN edit_policy TEXT NOT NULL DEFAULT 'owner_only';

ALTER TABLE workspaces ADD COLUMN default_skill_edit_policy TEXT NOT NULL DEFAULT 'owner_only';

CREATE TABLE IF NOT EXISTS skill_change_requests (
    id TEXT PRIMARY KEY,
    skill_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    -- Attribution, not ownership: a deleted author must not erase the review trail.
    proposed_by TEXT REFERENCES users(id),
    reviewed_by TEXT REFERENCES users(id),
    -- Version the proposal was written against, so a merge can warn about drift.
    base_version_no INTEGER NOT NULL,
    title TEXT,
    note TEXT,
    markdown TEXT NOT NULL,
    -- 'open' | 'merged' | 'rejected' | 'withdrawn' — validated in src/skills/policy.ts.
    status TEXT NOT NULL DEFAULT 'open',
    review_note TEXT,
    merged_version_no INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_skill_change_requests_skill
    ON skill_change_requests(skill_artifact_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_change_requests_workspace
    ON skill_change_requests(workspace_id, status, created_at DESC);
