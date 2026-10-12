-- The personal-home onboarding checklist (no workspace) stored its state in
-- onboarding_state under a 'personal' sentinel workspace_id, which the
-- workspace_id → workspaces(id) foreign key rejects, so dismiss / skill-ack /
-- celebrate on the personal home always failed. Personal state gets its own
-- per-user table instead.
CREATE TABLE IF NOT EXISTS onboarding_personal_state (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  skill_ack_at  TEXT,
  dismissed_at  TEXT,
  celebrated_at TEXT
);
