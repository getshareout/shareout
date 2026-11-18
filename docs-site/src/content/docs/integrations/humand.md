---
title: Humand
description: Read employees, departments, time off and attendance from Humand into your artifacts.
---

Connect your Humand community once per workspace and build pages on your people data:
headcount by department, time off this month, attendance, course progress, survey answers.

The connector is **read-only**. ShareOut only calls Humand's read endpoints; it cannot
create, change or deactivate users, post, upload documents, read chats or touch your API key.

## Connect

1. Get your community's **API key** from Humand (your Humand implementation contact gives it).
2. In ShareOut, open **Connectors** → **People & HR** → **Humand**.
3. Paste the key (with or without the `Basic ` prefix), click **Test**, then save.

Humand allows 100 requests per minute per key.

## Use it in an artifact

```javascript
const sdk = await ShareOut.create();
const conn = (await sdk.platform.connections()).find((c) => c.name === 'humand');

const { data } = await sdk.platform.execute('humand', 'users.list', {
  connectionId: conn.id,
  params: { queryParams: { page: 1, limit: 100 } },
});
console.log(data.count, data.users);
```

Lists are paged: send `page` (from 1) and `limit` (up to 500 on most lists); without them you
get page 1 of 10. The response's `pagination.cursor` is the next page number.
`timeTracking.entries` needs `employeeId`, `startDate` and `endDate`.

## Ask the assistant

Tick **AI** on the Humand connector card and every member of the workspace can ask the
ShareOut assistant (web, Telegram, Slack) or ShareOut in Claude/ChatGPT (MCP) things like
"who is on vacation next week?" or "how many people are in each department?". The assistant
reads Humand with the `read_connector` tool, read-only.

## What you can read

| Area | Endpoints |
| --- | --- |
| People | `users.list`, `users.get`, `users.me`, `users.profilePictures`, `profileFields.list`, `segmentations.list`, `segmentations.users` |
| Organization | `departments.list` / `.get` / `.members`, `jobPositions.list` / `.get` / `.members` |
| Time off | `timeOff.requests`, `timeOff.balances`, `timeOff.balancesByCycle` |
| Attendance | `timeTracking.entries`, `timeTracking.daySummaries`, `workSchedules.list`, `shifts.calendar`, `shifts.planning`, `shifts.templates` |
| Learning | `courses.list` / `.get` / `.usersProgress`, `learningPaths.usersProgress`, `knowledgeLibraries.list` / `.get` / `.tree` |
| Engagement | `forms.answers`, `acknowledgements.list`, `goals.list`, `goalFormulas.list`, `competencies.list`, `exchanges.list` |
| Service management | `serviceItems.list` / `.get` / `.tasks`, `serviceTasks.get` / `.approvalGroups`, `serviceStates.list` |

Query parameters are Humand's own; see the
[Humand Public API reference](https://api-prod.humand.co/public/api/v1/api-docs/).

Humand data is personal data. Keep pages that show it private, or share them only with
the people who should see it.
