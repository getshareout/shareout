-- People in the same workspace asked for a simple way to write to each other inside ShareOut,
-- without a separate chat tool. A direct message is one-to-one between two internal members of
-- one workspace (src/messages). It is sent from the Messages menu, the assistant (web, Telegram),
-- MCP or the API; `sent_via` records which, so the reader sees when a person's assistant wrote it.
-- The recipient is told on Home (bell + Messages menu) and on their linked Telegram.
--
-- One thread per pair of people per workspace (`pair_key` = the two user ids, sorted, joined by
-- ':'). Each side's read state lives on direct_message_members.
CREATE TABLE IF NOT EXISTS direct_message_threads (
  id              TEXT PRIMARY KEY,                                           -- dmt_…
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pair_key        TEXT NOT NULL,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  last_message_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_direct_message_threads_workspace_pair
  ON direct_message_threads(workspace_id, pair_key);

CREATE TABLE IF NOT EXISTS direct_message_members (
  thread_id    TEXT NOT NULL REFERENCES direct_message_threads(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT,
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_direct_message_members_user ON direct_message_members(user_id);

CREATE TABLE IF NOT EXISTS direct_messages (
  id          TEXT PRIMARY KEY,                                               -- dm_…
  thread_id   TEXT NOT NULL REFERENCES direct_message_threads(id) ON DELETE CASCADE,
  sent_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,               -- a page the message points to
  sent_via    TEXT NOT NULL DEFAULT 'web' CHECK (sent_via IN ('web','api','mcp','assistant')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_direct_messages_thread_created ON direct_messages(thread_id, created_at DESC);

-- A message an MCP client drafted for the person (src/mcp/message-tools.ts). send_message's first
-- call stores it and returns its id as the confirm_token; the second call deletes the row and sends
-- what it holds (DELETE … RETURNING), so a token sends once, only for its sender, within
-- `expires_at` (10 minutes). Drafts nobody confirmed are removed on the sender's next draft.
CREATE TABLE IF NOT EXISTS direct_message_drafts (
  id           TEXT PRIMARY KEY,                                               -- dmd_… (the confirm_token)
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sent_by      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  artifact_id  TEXT REFERENCES artifacts(id) ON DELETE CASCADE,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_direct_message_drafts_sender ON direct_message_drafts(sent_by, expires_at);
