-- Where and on what a one-time code was opened, so the owner can tell "Ana, on her phone in
-- Rosario" from "someone on a computer in another province". Coarse location as Cloudflare
-- reports it (city, region, country) and the browser + system from the user agent — never the
-- IP. Set once, with opened_at, when the code is redeemed.
ALTER TABLE artifact_view_codes ADD COLUMN opened_city TEXT;
ALTER TABLE artifact_view_codes ADD COLUMN opened_region TEXT;
ALTER TABLE artifact_view_codes ADD COLUMN opened_country TEXT;
ALTER TABLE artifact_view_codes ADD COLUMN opened_browser TEXT;

-- What the code page says before anything opens, per page: the owner's own words ("Carta del
-- socio fundador · Abrir la carta") instead of the generic "Enter your code · Open". Anyone
-- holding the link sees it, so it never carries the confidential part. The workspace's logo,
-- name and color on that page come from workspaces.branding.
CREATE TABLE IF NOT EXISTS artifact_view_gates (
  artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE,
  title       TEXT,
  message     TEXT,
  button      TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
