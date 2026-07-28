# Public Artifacts — Launch Checklist

Status of the public-artifacts hardening program and the steps required before
enabling open visibility for real users. Code workstreams A–H are implemented;
the items below are the operational/legal gates that are **not** code.

## Code shipped (for reference)
- **A** Read-only-default backend — anon viewers can't write/email/agent/collab on a public artifact.
- **B** Publish-time moderation (AI classify, fail-safe pending, takedown page, admin queue).
- **C/E** Tier-gated "Made with ShareOut" badge + Report link; tier knobs.
- **D** Reactive abuse pipeline — `/report/:id`, CSAM auto-pause, N-report auto-block, daily re-scan.
- **F** Anti-Sybil — Turnstile on signup, email-required-for-public, public-artifact cap.
- **G** Storage quota; estimated-bandwidth auto-pause (daily).
- **H1** Content-domain reputation monitor (watches `shareoutcdn.site`).
- **Rollout** Gradual per-user wave + KV kill switch + abuse auto-rollback.

## Operational gates BEFORE enabling the rollout

### 1. Turnstile prod secret
- [ ] Confirm the widget renders on the login page and the create page in prod.
- [ ] `wrangler secret put TURNSTILE_CLOUDFLARE_SECRETKEY` (worker). Until set,
      `verifyTurnstile` no-ops. Do NOT set it before the widgets are live, or
      `email/start` will reject every signup.

### 2. URL Scanner permission
- [ ] Grant the prod `CF_API_TOKEN` **URL Scanner** permission so B/D/H reputation
      checks work (optional; they no-op without it).

### 3. Legal / compliance (REQUIRED before free GA) — needs a human/lawyer
- [ ] **Terms of Service** updated: users grant the right to AI-moderate, withhold,
      block, and take down content; hosting is "as-is"; prohibited-content list.
- [ ] **DMCA**: register a designated agent (US Copyright Office); publish a notice +
      takedown address. Wire the report queue to it.
- [ ] **Abuse contact**: stand up `abuse@shareout.site`; route to the superadmin
      moderation/abuse queues (`/v1/admin/moderation`, `/v1/admin/abuse`).
- [ ] **CSAM / NCMEC**: a CSAM-tagged report already auto-pauses + blocks + alerts.
      Confirm the legal obligation to report to NCMEC (US) and the process to do so.
- [ ] **Governing law / disputes** clause for wrongful-takedown claims.

### 4. Rollout sequence (after the above)
1. Keep `OPEN_VISIBILITY_DISABLED=1` (default-deny baseline).
2. `PUBLIC_ROLLOUT_USERS=<your-user-id>` → smoke test publishing public.
3. `PUBLIC_ROLLOUT_PCT=1` → ramp slowly (5 → 25 → 100).
4. **Kill**: set `PUBLIC_ROLLOUT_PCT=0`, or flip the KV kill switch
   (`public_rollout_killed`) for an instant stop (no deploy). Auto-rollback trips it
   when abuse reports exceed `PUBLIC_ABUSE_AUTOKILL_PER_DAY` (default 50) in 24h.

## Known follow-ups (deferred, documented)
- **Exact** per-byte bandwidth metering (current G is an estimate: views × entrypoint
  size from `analytics_daily`, no hot-path counting). Upgrade path: extend the views
  queue/`analytics_daily` to accumulate served bytes.
- Owner email notifications for moderation pending/blocked (responses surface state today).
- Rendered superadmin queue UI pages (the JSON endpoints exist).
- Per-artifact paid badge opt-out toggle; epoch-precise cache bust on tier change.
- Backfill scan of pre-existing public/showcase artifacts.
- Multi-domain content sharding by trust tier.
