-- Where and on what a one-time code was opened, so the owner can tell "Ana, on her phone in
-- Rosario" from "someone on a computer in another province". Coarse location as Cloudflare
-- reports it (city, region, country) and the browser + system from the user agent — never the
-- IP. Set once, with opened_at, when the code is redeemed.
ALTER TABLE artifact_view_codes ADD COLUMN opened_city TEXT;
ALTER TABLE artifact_view_codes ADD COLUMN opened_region TEXT;
ALTER TABLE artifact_view_codes ADD COLUMN opened_country TEXT;
ALTER TABLE artifact_view_codes ADD COLUMN opened_browser TEXT;
