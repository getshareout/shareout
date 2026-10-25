-- Why: access requests only ever asked to VIEW. A viewer (or workspace admin) who hits a page
-- they can't edit now asks for edit access the same way; approving adds them as an editor.
-- Additive: one column, existing rows stay view requests.

ALTER TABLE access_requests ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'; -- viewer | editor
