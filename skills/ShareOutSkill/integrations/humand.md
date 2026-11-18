# Integration: Humand

Humand (employee app / HR platform) as a workspace platform connector (`kind: platform`,
provider `humand`). Runs server-side over Humand's Public API — the page never sees the key.
**Read-only:** only GET endpoints exist; Humand's write endpoints (create/deactivate users,
posts, documents, API-key rotate/revoke) and chats are not exposed.

## Create

Admins add it in **Connectors** (Home → People & HR → Humand): paste the community's API
key, **Test**, save. The key comes from Humand (your Humand implementation contact).
A key pasted with the `Basic ` prefix from Humand's docs works too.

```json
{ "name": "humand", "kind": "platform", "provider": "humand", "config": {},
  "credentials": { "type": "oauth", "data": { "access_token": "<humand api key>" } } }
```

Test calls `GET /users/me`. Rate limit: 100 requests per minute per key (Humand's).

## Query from an artifact

```javascript
const sdk = await ShareOut.create();
const conn = (await sdk.platform.connections()).find((c) => c.name === 'humand');

const { data } = await sdk.platform.execute('humand', 'users.list', {
  connectionId: conn.id,
  params: { queryParams: { page: 1, limit: 100 } },
});
// data → { count, users: [{ employeeInternalId, firstName, lastName, email, segmentations, … }] }

const off = await sdk.platform.execute('humand', 'timeOff.requests', {
  connectionId: conn.id,
  params: { queryParams: { fromDate: '2026-11-01', toDate: '2026-11-30', limit: 500 } },
});
// off.data → { page, totalPages, count, items: [...] }; off.pagination → { hasMore, cursor: '<next page>' }
```

Paging: send `page` (from 1) and `limit` (max 500 on most lists); paged lists default to
`page=1&limit=10` when you omit them. The response's `pagination.cursor` is the next page number.

## Workspace assistant and MCP

Every internal member can read Humand from the workspace assistant (web, Telegram, Slack)
and from the MCP connector (Claude, ChatGPT…) once an admin ticks **AI** on the Humand
connector card. Tools:

- `list_connections` → the Humand connector shows `readable: true`.
- `read_connector` with only `connection` → the endpoint list (`id`, `path_params`, `paged`).
- `read_connector` with `endpoint`, `query`, `path` → `{ data, total, next_page }`. Answers
  over ~50 KB keep the first items of the list and say `truncated`; ask for a smaller
  `limit` or the next page.

```json
{ "connection": "humand", "endpoint": "timeOff.requests", "query": { "fromDate": "2026-11-01", "limit": 200 } }
```

Same gates as the SQL tools: AI switch per connector, per-workspace query limit, external
members excluded. Only GET endpoints are callable.

## Endpoints

| id | Humand path | Notes |
|---|---|---|
| `users.me` | `/users/me` | The key's own user |
| `users.list` · `users.get` | `/users` · `/users/{employeeInternalId}` | `search`, `page`, `limit` |
| `users.profilePictures` · `profileFields.list` | `/users/profile-pictures` · `/profile-fields` | |
| `segmentations.list` · `segmentations.users` | `/segmentations` · `/segmentations/users` | |
| `departments.list` · `.get` · `.members` | `/departments[/{id}[/members]]` | |
| `jobPositions.list` · `.get` · `.members` | `/job-positions[/{id}[/members]]` | |
| `timeOff.balances` · `timeOff.balancesByCycle` · `timeOff.requests` | `/time-off/...` | requests: `states`, `fromDate`, `toDate`, `employeeInternalId` |
| `timeTracking.daySummaries` · `timeTracking.entries` | `/time-tracking/...` | entries **require** `employeeId` (one), `startDate`, `endDate` |
| `workSchedules.list` · `shifts.calendar` · `shifts.planning` · `shifts.templates` | | |
| `courses.list` · `.get` · `.usersProgress` · `learningPaths.usersProgress` | `/courses/...` | progress: `groupIds`, `userFields` |
| `forms.answers` | `/forms/{id}/answers` | surveys and forms |
| `acknowledgements.list` · `goals.list` · `goalFormulas.list` · `goalFormulas.rangeFields` · `competencies.list` | | |
| `knowledgeLibraries.list` · `.get` · `.tree` | `/knowledge-libraries/...` | |
| `serviceItems.list` · `.get` · `.tasks` · `serviceTasks.get` · `.approvalGroups` · `.approvalGroup` · `serviceStates.list` | `/service-management/...` | |
| `exchanges.list` | `/exchanges` | marketplace |

Path params go in `params.pathParams` (`{ id: 12 }`); all must be set, and dot segments
(`..`) are refused. Errors: a rejected key → `HUMAND_401` "API key rejected by Humand";
a `400` carries Humand's validation text (`HUMAND_400` "Humand rejected the request: employeeId should
not be null or undefined; …"); other upstream failures carry only the HTTP status. Full Humand spec:
https://api-prod.humand.co/public/api/v1/api-docs/

Humand data is personal data (names, emails, IDs, birthdays). Keep pages that show it
private or shared with the people who should see it.
