-- One-time view codes: a page shared as "link + a personal code" (sent over WhatsApp, say)
-- instead of a sign-in. Each code opens the page once, for view_seconds, then never again.
-- artifacts.auth_method = 'onetime' turns the gate on. Only the code's hash is stored; the
-- code itself is shown once, to whoever created it. `label` is who the code is for — it is
-- the watermark the viewer sees, so a screenshot names the person it came from.
CREATE TABLE IF NOT EXISTS artifact_view_codes (
  id            TEXT PRIMARY KEY,                                     -- vcd_…
  artifact_id   TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  code_hash     TEXT NOT NULL,
  view_seconds  INTEGER NOT NULL,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  opened_at     TEXT,                                                 -- set once, when the code is redeemed
  opened_device TEXT,                                                 -- 'phone' | 'tablet' | 'computer', from the user agent
  revoked_at    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_artifact_view_codes_artifact_hash ON artifact_view_codes(artifact_id, code_hash);

-- What the viewer tried while the page was open: copy, print, save, right-click, the
-- screenshot key, leaving the tab. Signals, not proof — a phone screenshot sends nothing.
-- Capped per code in code (artifacts/view-codes/store.ts).
CREATE TABLE IF NOT EXISTS artifact_view_code_events (
  id          TEXT PRIMARY KEY,                                       -- vce_…
  code_id     TEXT NOT NULL REFERENCES artifact_view_codes(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_artifact_view_code_events_code ON artifact_view_code_events(code_id);
