-- Why: Sign in with Microsoft needs a stable key for the account it signed in, the way
-- `google_id` is for Google. Microsoft documents `email` as mutable and unverified, so
-- an address only links an existing user the first time; after that the user is found
-- by `microsoft_id` = '<tid>:<oid>' (tenant id + object id), and an address that turns
-- up under a different Microsoft identity is refused instead of merged.

ALTER TABLE users ADD COLUMN microsoft_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_microsoft_id ON users(microsoft_id);
