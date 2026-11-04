-- Who a workspace's invoices are made out to. An Argentine invoice (factura) must carry the
-- buyer's legal name, CUIT, IVA condition and fiscal address; the operator also needs a postal
-- code and a phone to issue it. The workspace's owners and admins keep it current from
-- Admin → Billing; the instance operator reads it when billing. One row per workspace.
-- Validation (CUIT check digit, required fields) lives in src/workspaces/billing-profile.ts.
CREATE TABLE IF NOT EXISTS workspace_billing_profiles (
  workspace_id  TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  country       TEXT NOT NULL DEFAULT 'AR',                 -- ISO 3166-1 alpha-2
  legal_name    TEXT,                                       -- razón social
  tax_id        TEXT,                                       -- digits only for a CUIT (country AR)
  tax_condition TEXT,                                       -- AR: responsable_inscripto | monotributo | exento | consumidor_final
  address       TEXT,                                       -- fiscal address: street and number
  city          TEXT,
  province      TEXT,
  postal_code   TEXT,
  phone         TEXT,
  billing_email TEXT,                                       -- where invoices go, when not the admins
  updated_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
