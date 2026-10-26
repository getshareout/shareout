raw notes from the team channel, newest last — please clean up

- 2026-08-04 v2.3.0: added CSV export on reports. fixed date picker showing wrong week start for locales that start on monday
- 2026-08-19 v2.3.1: hotfix — login loop on safari 17 when 3rd party cookies blocked
- 2026-09-02 v2.4.0: new "Teams" page (invite, roles: owner/admin/member). dark mode beta (settings > appearance). removed legacy v1 API endpoints (deprecated since jan, emailed everyone in june)
- 2026-09-15 v2.4.1: perf: dashboard loads ~40% faster for accounts with >10k records. fixed: timezone shown as UTC in email digests
- 2026-10-01 v2.5.0: scheduled reports (weekly/monthly) by email. audit log for admins. BREAKING: webhook payload `user` field renamed to `actor`
- 2026-10-14 v2.5.1: fixed CSV export dropping rows with emoji in names
