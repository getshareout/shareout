# Page Pilot

Page Pilot is an opt-in in-page GUI agent for published artifacts. Viewers give a natural-language task ("filter the table to pending orders from last week") and an agent loop clicks, types, and scrolls the real UI on their behalf. It runs inside the artifact's iframe with viewer-level permissions.

> **Not the same as visitor chat.** `sdk.agent.chat()` answers questions about data. Page Pilot *operates* the page. Use chat when viewers need to ask questions; use Pilot when they need to perform multi-step UI actions without knowing the exact controls.

Built on the open-source `page-agent` library (MIT, alibaba/page-agent), served self-hosted at `/sdk/page-pilot.js`. LLM calls are proxied server-side — no API key in the browser — and billed to the workspace under usage mode `'pilot'`.

## Enabling Page Pilot

Page Pilot is **off by default**. Enable it per-artifact via the agent admin config endpoint (owner or editor auth — session or API token):

```bash
curl -X POST "$ORIGIN/v1/data/{artifactId}/agent/admin/config" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "pilot_enabled": true }'
```

Read the current state (public endpoint, no auth):

```bash
GET /v1/data/{artifactId}/agent/config
# Response data includes: { "pilot_enabled": true }
```

Partial updates are safe — `PUT /agent/admin/config` coalesces omitted fields with the existing config, so you can toggle `pilot_enabled` without resending every other key.

## SDK Reference

### `so.agent.pilot(task, options?)`

Runs one Pilot task. Returns a promise that resolves when the task completes or fails.

```javascript
const so = await ShareOut.create();

const result = await so.agent.pilot(
  'Filter the table to pending orders from last week',
  {
    maxSteps: 15,          // Steps to allow (1–20; default 15; server caps at 20)
    instructions: 'This dashboard manages customer orders. The Add Order form is below the table.',
    showPanel: true,       // Floating progress panel visible to the viewer (default: true)
    maskContent: true,     // Redact card numbers and emails from what the LLM sees (default: true)
    onEvent: (e) => {      // Optional event stream
      // e.kind: 'status' | 'activity' | 'history'
      console.log(e.kind, e.detail);
    },
  }
);

// result shape
// {
//   success: boolean,
//   data: string,                // the agent's final text answer / outcome summary
//   steps: number,               // steps taken
//   usage: {
//     promptTokens: number,
//     completionTokens: number,
//     totalTokens: number,
//   }
// }
```

### `so.agent.pilot.stop()`

Cancel a Pilot run in progress.

```javascript
so.agent.pilot.stop();
```

### Built-in chat widget (Ask / Do)

When `pilot_enabled` is true on the artifact, the pre-built visitor chat widget reveals an **[Ask][Do]** segmented toggle:

| Mode | Behavior |
| --- | --- |
| **Ask** | Standard visitor chat (`sdk.agent.chat`) — answers questions about data |
| **Do** | Routes the message to `so.agent.pilot` with `showPanel: false` — progress renders as an in-thread activity bubble; **Send** swaps to **Stop** while running |

Mount options:

```javascript
sdk.agent.widget.mount('#chat', {
  mode: 'auto',              // 'ask' | 'auto' (default auto — shows toggle when pilot enabled)
  pilot: true,               // false forces chat-only even when owner enabled pilot
  pilotInstructions: '…',    // Page layout hint passed to every Do task
});
```

When the agent needs clarification mid-task, **`ask_user`** bridges to the composer — the viewer's next message answers the question and the loop resumes.

## Event types (`onEvent`)

| `e.kind` | `e.detail` | When fired |
|----------|------------|------------|
| `'status'` | agent status transition (`idle` → `running` → `completed`/`error`/`stopped`) | Start, completion, failure |
| `'activity'` | `{ type: 'thinking' \| 'executing' \| 'executed' \| 'retrying' \| 'error', tool?, input?, ... }` | Real-time progress during each step |
| `'history'` | updated step/event log | After each completed step |

## Authoring Guidance

### Use honest interactive DOM

The agent detects interactive elements by cursor style, tag, and ARIA attributes. A `<div>` styled to look like a button but with no `role`, `tabindex`, or pointer cursor is invisible to it. Use real elements:

```html
<!-- Agent can find these -->
<button onclick="addOrder()">Add Order</button>
<select id="status-filter">...</select>
<input type="text" placeholder="Search orders">

<!-- Agent cannot reliably find these -->
<div class="btn" style="cursor:pointer" onclick="addOrder()">Add Order</div>
```

Add `aria-label` when an element's purpose isn't obvious from its text.

### Mark sensitive regions with `data-so-private`

Any element carrying `data-so-private` is excluded from the agent's vision — the LLM never sees its content. Use it for PII, card numbers, or any data the viewer should interact with but not expose to the model.

```html
<td data-so-private>4111 1111 1111 1234</td>
<span data-so-private class="user-email">alice@example.com</span>
```

`maskContent: true` in the pilot call is a broader alternative: it auto-redacts common patterns (card numbers, emails) page-wide, but `data-so-private` is more precise and always preferred.

### Provide `instructions` describing the page

The agent cold-starts with no knowledge of your layout. A short `instructions` string — what the page is, what its main sections are, where key forms live — measurably improves task success:

```javascript
await so.agent.pilot(task, {
  instructions: `
    Order management dashboard.
    Top: KPI cards (total orders, revenue, pending count).
    Middle: orders table with Status and Date columns, filterable.
    Right sidebar: "Add Order" form — Name, Product, Quantity, Status fields.
  `,
});
```

## Limits and Billing

| Constraint | Value |
|------------|-------|
| Max steps per call | 20 per task (server-enforced) — bounds one task's agent loop, not overall spend |
| Cost control | Per-artifact rate limits (default 10 req/min, 100k tokens/day) — the actual guard on usage |
| Default `maxSteps` | 15 |
| Billing mode | `'pilot'` in workspace AI usage ledger |
| Balance exhausted | HTTP 402 from server |
| Rate cap exceeded | HTTP 429 from server |

Pilot shares the workspace AI balance with visitor chat. Monitor usage via the existing `GET /v1/data/{artifactId}/agent/usage` endpoint (the `pilot` mode appears alongside `visitor` and `admin`).

## Minimal Example

```html
<!DOCTYPE html>
<html>
<head>
  <title>Orders Dashboard</title>
  <link rel="stylesheet" href="$ORIGIN/sdk/shareout.css">
  <script src="$ORIGIN/sdk/shareout.js"></script>
</head>
<body>
  <div class="so-toolbar">
    <input id="pilot-task" class="so-input" placeholder="What would you like to do?">
    <button id="run-pilot" class="so-btn so-btn-primary">Go</button>
    <button id="stop-pilot" class="so-btn" style="display:none">Stop</button>
  </div>

  <p id="pilot-status" class="so-text-muted"></p>

  <table>
    <thead><tr><th>Order</th><th>Status</th><th>Amount</th></tr></thead>
    <tbody id="orders"><!-- populated by sdk.table --></tbody>
  </table>

  <form id="add-order-form" aria-label="Add Order">
    <input name="name" placeholder="Customer name" required>
    <select name="status">
      <option>pending</option><option>shipped</option><option>closed</option>
    </select>
    <button type="submit">Add Order</button>
  </form>

  <script>
  (async () => {
    const so = await ShareOut.create();
    const status = document.getElementById('pilot-status');
    let running = false;

    document.getElementById('run-pilot').onclick = async () => {
      const task = document.getElementById('pilot-task').value.trim();
      if (!task || running) return;

      running = true;
      document.getElementById('stop-pilot').style.display = '';
      status.textContent = 'Running…';

      const result = await so.agent.pilot(task, {
        maxSteps: 15,
        instructions: 'Order management dashboard. Table shows orders. Add Order form is below the table.',
        showPanel: true,
        onEvent: (e) => {
          if (e.kind === 'activity' && e.detail?.tool) status.textContent = e.detail.tool;
        },
      });

      running = false;
      document.getElementById('stop-pilot').style.display = 'none';
      status.textContent = result.success ? 'Done.' : `Failed: ${result.data || 'unknown'}`;
    };

    document.getElementById('stop-pilot').onclick = () => {
      so.agent.pilot.stop();
    };
  })();
  </script>
</body>
</html>
```

## Security

- Agent acts only within the artifact iframe with the **viewer's** session permissions — it cannot read or write other artifacts.
- Server rejects tool calls that request arbitrary JS execution.
- `data-so-private` regions are stripped from the agent's vision before the LLM call.
- `maskContent: true` auto-redacts common PII patterns (card numbers, email addresses) page-wide.
- Workspace balance and step caps bound worst-case cost per call.
- Server-side **prompt-injection scrub** on user/tool message text (24 KB cap per message) before the completions proxy — system and assistant messages are never scrubbed.
- SDK **oscillation guard** stops A-B-A-B action loops (in addition to three identical consecutive steps) so alternating mis-clicks do not burn the full step budget.

## Related

- [overview.md](overview.md) — in-artifact visitor chat (`sdk.agent.chat`)
- [context.md](context.md) — context injection for visitor chat
