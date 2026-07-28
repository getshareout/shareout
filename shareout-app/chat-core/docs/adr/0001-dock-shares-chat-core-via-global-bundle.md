# Dock shares chat-core via the global bundle, not extraction

The home agent dock ships as an inline `<script>` string fragment welded into a
14-fragment shared-scope IIFE (it uses `openArtifact`, `activeArt`, `createMode`,
`ws`, `scrim` from siblings and defines `composer`/`openComposer`/`setComposer` they
depend on), so it cannot `import`. To give it the same reading behaviour as the other
surfaces we load the existing chat-core IIFE global (`/sdk/chat-core.js`) on the home
page and have the dock use `window.ChatCore`, guarded by `if (window.ChatCore)` with a
fallback to its prior inline behaviour so it degrades, never dies.

We chose this over fully extracting the workspace client into a bundled module (C2):
that is the cleaner end-state but a large, separate refactor of the most-used screen's
hydration, out of scope for the streaming-principles work. C2 remains a deferred
follow-up.
