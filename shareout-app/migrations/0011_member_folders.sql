-- Why: Team Space folders were admin-only, so a member who wanted to organise their
-- own work had to ask an admin for every folder. Admins now choose: when this is on,
-- members create folders and rename/delete the ones they created (folders.created_by);
-- everyone else's folders stay admin/owner-only. On by default, for existing
-- workspaces too. API name: `members_can_create_folders`.

ALTER TABLE workspaces ADD COLUMN member_folders_enabled INTEGER NOT NULL DEFAULT 1;
