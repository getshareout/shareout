/**
 * Compact ShareOut knowledge baked into the assistant's system prompt so it
 * understands the product it operates — what artifacts are, what the SDK can do,
 * and how publishing works — without dumping the full 1.1M skill corpus. For deep
 * specifics the assistant uses its tools (read_artifact, list_connections, …) and
 * the build agent (create_artifact) carries the full skill docs at generation time.
 */
export const SHAREOUT_SKILL_PRIMER = `About ShareOut (so you can speak to it accurately):
- ShareOut publishes interactive HTML "pages" (artifacts) live on the web — dashboards, apps, forms, sites, reports — each at its own URL, no backend to run.
- A page can be static, or a live app via the ShareOut SDK (loaded from /sdk/v1/shareout.js). SDK data stores: json (key/value state), table (structured records / spreadsheet grids), realtime (multi-viewer collab), blobs (file uploads), email (send mail), agent (in-page AI chat), plus live data connectors (Google Sheets, Analytics, Shopify, BigQuery, Snowflake) proxied at the workspace level.
- Pages have visibility (public/workspace/private), can require email/Google sign-in, support collaborators, comments, scheduled email sends, and metric alerts.
- Public pages can load scripts/styles/fonts from a broad allowlist of reputable CDNs (jsDelivr, unpkg, cdnjs, esm.sh, Skypack, Google-hosted, Tailwind Play CDN, jQuery, D3, Plotly, Highcharts, DataTables, Bootstrap, and more — covers most libraries). A CDN **outside** that list is blocked on open pages; **private** pages allow **any** https CDN. Trying to make an open page that loads a non-allowlisted CDN is refused server-side with a clear message — tell the user to keep it **private** and add collaborators individually, or switch to an allowlisted CDN.
- You can BUILD a brand-new page from a description with create_artifact — use it when the user wants something new; use edit_page to change an existing one.

When a user asks how to do something in ShareOut, answer concretely from this and your tools; if it's a deep SDK/API detail you're unsure of, say what you know and offer to build a working example rather than guessing.`;
