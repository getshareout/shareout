## Summary
<!-- What & why -->

## Test plan
<!-- No hosted CI: local checks are the gate (AGENTS.md → Gate contract). Don't run the full
     suite on a feature branch; it runs once on the integrated branch (tooling/scripts/integrate.sh). -->
- [ ] Targeted tests (in `shareout-app/`): `npm run test:affected` or `TZ=UTC npx vitest run <files>`
- [ ] Light pre-push checks pass — static guards, typecheck, secrets, bundles (by hand, from the repo root: `SHAREOUT_CHECK_MODE=light ./tooling/scripts/ci-check-fast.sh`)
- [ ] (if UI) human visual pass
