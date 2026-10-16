-- Why: a version's message is either written by whoever published it or generated in
-- the background as a short "what changed" summary. The history panel badges the
-- generated ones so nobody mistakes a model's guess for the author's words.
-- message_source is 'author' or 'ai'; null when there is no message (or it predates this).

ALTER TABLE versions ADD COLUMN message_source TEXT;
