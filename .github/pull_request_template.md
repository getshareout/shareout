## Summary
<!-- What & why -->

## Test plan
<!-- No hosted CI: local checks are the gate (AGENTS.md → Gate contract). Don't run the full
     suite on a feature branch; it runs once on the integrated branch (tooling/scripts/integrate.sh). -->
- [ ] Targeted tests (in `shareout-app/`): `npm run test:affected` or `TZ=UTC npx vitest run <files>`
- [ ] Light pre-push checks pass — static guards, typecheck, secrets, bundles (by hand, from the repo root: `SHAREOUT_CHECK_MODE=light ./tooling/scripts/ci-check-fast.sh`)
- [ ] (new feature or a change people notice) `CHANGELOG.md` → Release notes line (en + `es:` + `Integrators:`) and Unreleased entry; skill, MCP text and docs (en + es) updated in this PR — `check:changelog` enforces it (`Docs: none` / `Skill: none` / `Changelog: none` in a commit message when one really doesn't apply)
- [ ] (if UI) human visual pass
