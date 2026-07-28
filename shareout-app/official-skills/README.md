# Official skills (vendored source)

Markdown sources for the **Recommended by ShareOut** skills that appear in every
workspace's Skill Library. These are committed here so the build is deterministic:
`scripts/embed-official-skills.mjs` reads them at `predeploy` and generates
`src/skill-marketplace/official-content.generated.ts`, which the daily cron
(`syncOfficialSkills`) publishes into the hidden system workspace and flags
`official = 1` in `skill_marketplace`.

- Order, display name, category, and attribution live in
  [`src/skill-marketplace/official-registry.ts`](../src/skill-marketplace/official-registry.ts).
- One `.md` per entry, filename = registry `sourceFile`.
- `shareout.md` is ShareOut's own skill (the canonical primer served at `/v1/skill`).
  The rest are third-party skill packs, redistributed with attribution — do not
  strip the `attribution` field when refreshing.

To refresh a skill's content: replace the `.md` here, then ship. The cron re-publishes
a new version only when the content hash changes.
