# Where does the ShareOut skill live?

**One source of truth. Three ways agents load it. Zero dual-editing.**

| | |
|--|--|
| **Edit here only** | [`skills/ShareOutSkill/`](ShareOutSkill/) in **this repo** (`getshareout/shareout`) |
| **Agents using an instance** | `GET {ORIGIN}/v1/skill` (zip) + `/v1/skill/version` |
| **Agents cloning skill alone** | Mirror repo [`getshareout/shareout-skill`](https://github.com/getshareout/shareout-skill) — **publish target**, not a second edit tree |

```text
  YOU EDIT                          AGENTS LOAD
  ────────                          ───────────
  shareout/skills/ShareOutSkill/
         │
         ├─►  npm run sync:skill  ──►  R2 / instance  ──►  GET $ORIGIN/v1/skill
         │
         └─►  (release mirror)    ──►  github.com/getshareout/shareout-skill
```

## Why not two sources?

Historically the monorepo copy and `shareout-skill` drifted (different versions,
missing folders). That confuses agents and humans. **Rule:**

1. All skill markdown PRs land in **`getshareout/shareout`** under `skills/ShareOutSkill/`.
2. After skill content changes, maintainers run `npm run sync:skill -- --bucket=<bucket>` (from
   `shareout-app/`; or set `SKILL_R2_BUCKET`) so each instance’s `GET $ORIGIN/v1/skill` matches
   this tree after deploy/sync. The bucket is the `bucket_name` of that instance's `ARTIFACTS`
   binding. There is no default: the script exits non-zero without one and prints the target
   before uploading.
3. The skill ships **with the product**; agents use `$ORIGIN/v1/skill`
   after deploy, or read `skills/ShareOutSkill/` from the clone.
4. The standalone repo is for “install this skill in my agent” UX (shallow clone,
   marketplace). It must be updated **from** this tree, never the other way around.

If you only have bandwidth for one place: **this monorepo path wins.**

## Skill version on an instance

`GET $ORIGIN/v1/skill/version`, `X-Skill-Version` and the `/v1/skill` ETag carry
`<SKILL.md frontmatter version>+<first 8 hex of the skill.zip sha256>`, e.g.
`2.60.0+18c8deb6`. The hash moves with every content change, so an agent that stores
the full string (or the ETag) and compares it for equality refreshes whenever the skill
changes — the frontmatter version alone is bumped by hand and rarely.

Backward compatibility: the `+…` part is semver build metadata, so a client comparing
semver still sees the frontmatter version (`/v1/skill/version` also returns it as
`semver`). An `If-None-Match` holding the old bare-semver ETag gets one `200` with the new
ETag, then `304`s as before.

The instance serves whichever copy is newer — the R2 sync or the asset staged with the
deployed Worker: higher frontmatter version, then later `updated_at`, then the later of
the R2 upload and the Worker version's deploy time (R2 when neither is known).

## What to open first

| Intent | File |
|--------|------|
| Install / deploy ShareOut on Cloudflare | [ShareOutSkill/deploy/SKILL.md](ShareOutSkill/deploy/SKILL.md) |
| Build & publish artifacts (use an instance) | [ShareOutSkill/SKILL.md](ShareOutSkill/SKILL.md) |
| Intent → file map | [ShareOutSkill/INDEX.md](ShareOutSkill/INDEX.md) |
| Cloudflare domain / D1 / DO checklist | [ShareOutSkill/deploy/cloudflare.md](ShareOutSkill/deploy/cloudflare.md) |

## Credentials (use + self-host)

```json
// ~/.shareout/credentials
{
  "token": "so_…",
  "origin": "https://your-instance.example"
}
```

Every example host in skill docs is **`$ORIGIN`** / **`$ORIGIN_HOST`**. There is
no public ShareOut cloud — resolve origin from credentials or deploy first.

## Syncing the public skill mirror

When `SKILL.md` version (or any skill content) changes on `main`, re-mirror so
[`getshareout/shareout-skill`](https://github.com/getshareout/shareout-skill) stays on par:

```bash
# from this monorepo (preserves skill-repo README.md + LICENSE)
./tooling/scripts/mirror-skill-repo.sh /path/to/shareout-skill
# then in the skill repo: commit, push, PR → merge
```

Do not day-to-day edit in the skill repo.

## Related product paths

| Path | Role |
|------|------|
| `shareout-app/official-skills/shareout.md` | Short marketplace “Recommended by ShareOut” primer (not the full skill tree) |
| `shareout-app/scripts/sync-skill-to-r2.mjs` | Uploads **this** tree to R2 for `/v1/skill` (bucket via `--bucket=` / `SKILL_R2_BUCKET`, required) |
| `docs-site/…/self-host/` | Human self-host docs (deploy skill is agent-first) |
