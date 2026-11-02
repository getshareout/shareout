-- Invoices the instance operator issues to a workspace by hand: a setup fee, a monthly fee,
-- a closed month's AI usage at metered cost. Nothing is charged here and nothing is gated on
-- them: the workspace pays outside ShareOut (a bank transfer), the operator attaches the
-- receipt and marks the invoice paid. Lines are a JSON snapshot taken at creation, so a later
-- price or usage reconcile never changes an invoice that was already sent.
CREATE TABLE IF NOT EXISTS workspace_invoices (
  id                TEXT PRIMARY KEY,                                            -- inv_…
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  number            TEXT NOT NULL,                                               -- what the receipt says, e.g. INV-2026-0001
  status            TEXT NOT NULL DEFAULT 'draft',                               -- 'draft' | 'open' | 'paid' | 'void'
  currency          TEXT NOT NULL DEFAULT 'USD',
  total_cents       INTEGER NOT NULL,
  period_month      TEXT,                                                        -- YYYY-MM the invoice covers, when it covers one
  lines_json        TEXT NOT NULL DEFAULT '[]',                                  -- [{kind, description, quantity, unit_cents, amount_cents, usage?}]
  notes             TEXT,                                                        -- payment instructions shown to the workspace (bank details)
  due_at            TEXT,
  issued_at         TEXT,                                                        -- set when it leaves draft
  receipt_r2_key    TEXT,                                                        -- the operator's receipt
  receipt_name      TEXT,
  receipt_type      TEXT,
  proof_r2_key      TEXT,                                                        -- the workspace's transfer proof
  proof_name        TEXT,
  proof_type        TEXT,
  proof_uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  proof_uploaded_at TEXT,
  paid_at           TEXT,
  paid_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
  payment_reference TEXT,                                                        -- the transfer's reference, as the operator saw it
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_workspace_invoices_workspace ON workspace_invoices(workspace_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_workspace_invoices_number ON workspace_invoices(number);
