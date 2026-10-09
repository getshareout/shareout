-- Why: a workspace whose people speak Spanish should get Spanish everywhere the
-- product talks to them — emails, the chat agent, the home shell, shared pages.
-- Nothing server-side knew a language before; the home shell guessed from the
-- browser. The workspace sets the default; a person may override it for themselves
-- (NULL = follow the workspace). Values: 'en' | 'es'.

ALTER TABLE workspaces ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
ALTER TABLE users ADD COLUMN locale TEXT;
