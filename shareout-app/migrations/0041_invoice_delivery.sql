-- Issuing an invoice now emails it to the workspace with its document attached, and a transfer
-- proof (uploaded in Admin → Billing, or sent as a reply to that email) marks it paid
-- (src/workspaces/invoice-mail.ts, src/email/invoice-ingest.ts). The operator has to be able to
-- see where an invoice went and why it is paid:
--   emailed_at / emailed_to — the last successful send and its recipients (a JSON array). Every
--                             send is also in email_sends and the audit log.
--   paid_source             — what marked it paid: 'operator' (by hand), 'proof' (the workspace
--                             uploaded its transfer proof) or 'email' (the proof came as a reply).
--                             NULL while unpaid; invoices paid before this column read as 'operator'.
--   reply_token             — the unguessable part of the invoice's reply address,
--                             invoice+<token>@<inbox domain>. Minted on the first send.
-- Additive: nullable columns only, nothing rewritten.
ALTER TABLE workspace_invoices ADD COLUMN emailed_at TEXT;
ALTER TABLE workspace_invoices ADD COLUMN emailed_to TEXT;
ALTER TABLE workspace_invoices ADD COLUMN paid_source TEXT;
ALTER TABLE workspace_invoices ADD COLUMN reply_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_workspace_invoices_reply_token ON workspace_invoices(reply_token);
