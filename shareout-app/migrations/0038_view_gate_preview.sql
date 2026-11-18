-- A one-time page can show a link preview: when `preview` is on, its code page answers 200 with
-- Open Graph tags (the gate's title, message and image), so WhatsApp, Slack, iMessage and the
-- rest draw a card instead of a bare URL. Off by default — a closed page advertises nothing.
-- `image` is the file name of the owner's preview image in R2 (view-gates/<image>), served
-- publicly at /vg/<image>; the name changes on every upload so caches never show an old one.
ALTER TABLE artifact_view_gates ADD COLUMN preview INTEGER NOT NULL DEFAULT 0;
ALTER TABLE artifact_view_gates ADD COLUMN image TEXT;
