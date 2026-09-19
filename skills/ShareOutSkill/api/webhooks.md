# Outbound Webhooks

There is no standalone webhook subscription/event system in this build — no event
envelope, no `artifact.published`/`data.changed`/`job.*` event types, no
`X-ShareOut-Signature` HMAC signing, and no multi-step retry schedule. Do not invent
one; nothing in `shareout-app/src` implements it.

The one real outbound webhook is the scheduled-job **`webhook` destination** — see
[jobs.md § WebhookConfig](jobs.md#webhookconfig) for the full config shape, and
[jobs.md § Retry Configuration](jobs.md#retry-configuration) for retry (`maxAttempts` /
`backoffType` / `initialDelay`, per-job, opt-in — default is a single attempt, no retry).

## What it actually sends

A `POST` (or `GET`/`PUT`/`PATCH`/`DELETE` per `config.method`) to your `url` (HTTPS
required), on the job's schedule:

```json
{
  "artifact_id": "art_abc123",
  "artifact_name": "My Report",
  "artifact_url": "$ORIGIN/a/my-report/",
  "triggered_at": "2026-09-19T09:00:00Z",
  "data": {}
}
```

- `data` is only present when `includeArtifactData: true` — up to 50 `sdk.json` keys.
- `User-Agent: ShareOut-Webhook/1.0`; any `config.headers` you set are merged in.
- **Unsigned.** There is no `X-ShareOut-Signature` header or HMAC scheme — if you need
  to verify the caller, put a shared secret in a custom header yourself
  (`config.headers`) and check for it server-side.
- Treated as failed (and retried per `retry_config`, if configured) on a non-2xx
  response or a fetch error; there is no distinction between 4xx and 5xx for retry
  purposes.

Only `email`, `slack`, and `telegram` support an immediate one-shot
`POST /v1/artifacts/{id}/deliver` (`{ "action": "…", "config": {...} }`) — `webhook` is
schedule-only, created through the Jobs API.

## Related

- [Jobs](jobs.md) - Scheduled webhook jobs, retry config, all destination types
- [Overview](overview.md) - API intro
