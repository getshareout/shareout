# Artifact Tests — safety nets for your artifact

Tests let an artifact owner catch breakage automatically when an artifact changes.
Enable once; every publish (and every manual run) checks that the artifact still
**runs** and passes **basic safety checks**. Default off — nothing runs until enabled.

> Honest scope: tests assert that your *code/rendering* and *data shape* are intact.
> They are **not** a security guarantee. The policy scan catches obvious mistakes,
> not obfuscated, encoded, runtime-loaded, or data-resident secrets. You're still
> responsible for what your artifact ships.

## What runs (Phase 1)

| Tier | What it checks | Cost |
|------|----------------|------|
| **Smoke** (T1) | Artifact loads, SDK initialises, no uncaught JS error | piggybacks the preview render |
| **Contract** (T2) | Stored data still has the expected shape (`table:` columns/row-count, `json:` schema) | read-only, fast |
| **Policy** | Obvious secret patterns in source, external-host map, CSP presence | static, advisory |

Result of a run is one of: **passed**, **failed**, or **errored** (the harness itself
couldn't run — never counted as a pass). Policy findings are **advisory**: they show
up and alert, but never block a version from going live.

## Modes (chosen when you enable)

- **monitor** (default) — the new version goes live immediately; tests run right
  after and flag failures. Best safety net for most artifacts.
- **block** — a failing new version is held back and the last good version keeps
  serving. Block only engages once a passing baseline exists, so your artifact never
  goes dark. Enabling block on a live artifact grandfathers the current version as
  the trusted baseline.

## Authoring the spec

Tests are a declarative file, `shareout.tests.json`, with **no code** — so it's safe
and easy to generate. Phase 1 uses read-only contract assertions:

```jsonc
{
  "contract": [
    { "store": "table:sales", "expect": { "columns": ["date", "amount"], "minRows": 1 } },
    { "store": "json:config", "expect": { "schema": { "title": "string" } } }
  ]
}
```

`store` is `table:<name>` or `json:<key>`. `expect` supports `columns`, `minRows`,
`maxRows` (tables) and `schema` (json: a field→type map of `string|number|boolean|object|array|null`).

Smoke + policy run automatically with no spec. The spec only adds contract checks.

### Agent guidance — generate, don't make the user write it

When you build or update an artifact that uses data stores, **offer to add a safety
net**: read the artifact's stores, propose a `shareout.tests.json` contract, and let
the owner approve. The owner should never have to hand-author selectors or schemas —
that's your job. Keep assertions to stable invariants (a column that must exist, a
config key the UI depends on), not volatile row values.

## API

All endpoints are owner-only except GET (which follows normal read access).

```
GET  /v1/artifacts/:id/tests           → { config, latest, runs }
PUT  /v1/artifacts/:id/tests           → set { enabled, mode, spec }
POST /v1/artifacts/:id/tests/run       → run now against the live version
```

Enable monitor mode with a contract:

```bash
curl -X PUT $ORIGIN/v1/artifacts/$ID/tests \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled":true,"mode":"monitor","spec":{"contract":[{"store":"table:sales","expect":{"minRows":1}}]}}'
```

Run on demand (bypasses the per-artifact debounce):

```bash
curl -X POST $ORIGIN/v1/artifacts/$ID/tests/run \
  -H "Authorization: Bearer $TOKEN"
```

## Scheduled runs

Beyond publish + manual triggers, you can run the artifact's enabled tests on a
schedule — a heartbeat that catches data/contract drift between publishes. Create a
scheduled job with the `artifact_test` action; it runs whatever tests the artifact
already has enabled against the live version (no extra config to author). The worker
cron is **hourly**, so schedules are hourly-granular.

```bash
curl -X POST $ORIGIN/v1/artifacts/$ID/jobs \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"artifact_id":"'$ID'","action":"artifact_test","trigger_type":"cron","schedule":"0 * * * *","config":{}}'
```

A non-passing scheduled run shows up as a failed job (visible in the job's logs and
`last_status`) and alerts the owner — the same alert a failing publish run sends.

## End-to-end flows (T3)

A `spec.flows` block drives the artifact in a real browser through declarative
steps — `{visit}`, `{click}`, `{fill}`, `{expect}` — to check that an interaction
path still works (a form renders and accepts input, a tab switch shows the right
content, etc.).

```json
{
  "enabled": true,
  "mode": "monitor",
  "spec": {
    "flows": [
      {
        "name": "contact form renders and accepts input",
        "steps": [
          { "expect": { "selector": "#contact-form" } },
          { "fill": ["#email", "test@example.com"] },
          { "click": "#submit" },
          { "expect": { "text": "Thanks" } }
        ]
      }
    ]
  }
}
```

**Read-only sandbox.** A flow runs against a sandboxed render: reads resolve as the
owner so the artifact loads, but **every data mutation is blocked** — no writes
persist, no emails send, no sibling artifacts are provisioned. Flows verify render
and client-side interaction, **not** write→read persistence. A step that submits a
form will see the submit blocked server-side; assert the UI's reaction, not stored
data. For data-shape checks use a `contract` assertion instead.

- `visit` may only navigate within the artifact's own origin (no external URLs).
- `expect.store` is not supported in flows yet — use a contract assertion.
- Flows run on publish, on manual runs, and on schedule, the same as other tiers,
  and gate BLOCK-mode promotion when a flow fails.
