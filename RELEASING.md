# Releasing ShareOut

Pre-release process for maintainers. There is no automated ship pipeline in this
public repo — self-hosters pull `main` and deploy with wrangler.

Also see [MAINTAINING.md](MAINTAINING.md) (branch protection, merge style) and
[ROADMAP.md](ROADMAP.md).

## Versioning

- Package version lives in `shareout-app/package.json` (`0.1.0` today).
- Tags use semver with an optional pre-release suffix: `v0.1.0-pre`, `v0.1.0`.
- Document user-facing changes in [CHANGELOG.md](CHANGELOG.md) under **Unreleased**,
  then move them under a dated version heading when tagging.

## Checklist before a tag

1. `main` is green (CI: worker coverage floors, docs build, gitleaks).
2. CHANGELOG **Unreleased** is accurate; no private/founder paths remain.
3. `./tooling/scripts/check-secrets.sh` is clean.
4. Optional: Deploy-to-Cloudflare path verified on a fresh account (Workers Paid
   for Durable Objects).

## Cut a release

```bash
# 1. Move Unreleased notes into ## [x.y.z] — YYYY-MM-DD in CHANGELOG.md
# 2. Bump shareout-app/package.json version if needed
git checkout main && git pull
git tag -a v0.1.0-pre -m "ShareOut v0.1.0-pre"
git push origin v0.1.0-pre
gh release create v0.1.0-pre --generate-notes --notes-file <(sed -n '/## \[0.1.0-pre\]/,/## \[/p' CHANGELOG.md | head -n -1)
```

Or draft the GitHub Release UI from the tag and paste the CHANGELOG section.

## What self-hosters should do

- Prefer a tag when available; otherwise track `main`.
- Apply D1 migrations on deploy (`npm run deploy` runs migrations then wrangler).
- Rotate secrets if upgrading from a compromised instance — see [SECURITY.md](SECURITY.md).

## Not in public CI

- Publishing to npm (packages stay `"private": true` until an intentional SDK release).
- Production deploy of shareout.site (maintainer private pipeline).
