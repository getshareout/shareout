---
title: Security & governance by plan
description: What every plan enforces, and what Teams adds — roles, publish approvals, audit log, moderation, and rate limits.
---

import { Aside } from '@astrojs/starlight/components';

Every ShareOut plan runs on the same security foundation — moderation, encryption,
and visibility controls apply to Personal and Teams alike. Teams adds governance
on top: internal approval gates, an audit trail, and workspace-scale roles. This
page is the matrix; each linked guide has the full detail.

## Roles

Two independent role systems, at two scopes:

| Scope | Roles | Applies to |
| --- | --- | --- |
| Workspace | `owner` > `admin` > `member` | Team-wide settings, billing, schedules, automations — see [Workspace admin](/teams/admin/) |
| Artifact | `owner` / `editor` / `viewer` | A single artifact's edit and view rights — see [Publishing artifacts → Collaborators](/guides/publishing/#collaborators) |

External people (clients, partners, suppliers) are a separate `member_class` —
they never appear on your workspace member list, never count toward seats, and
only see what's explicitly shared with them. See [External sharing](/teams/external-sharing/).

## Plan matrix

| Control | Free / Pro (Personal) | Teams / Enterprise |
| --- | --- | --- |
| AI moderation on public content | Yes | Yes |
| Credential encryption at rest | Yes | Yes |
| Visibility model (private / workspace / public) | Yes | Yes |
| Workspace roles (owner/admin/member) | — | Yes |
| Publish approvals (`require_approval` policy) | — | Yes |
| Audit log | — | Yes |
| Members per workspace | 3 max | Unlimited |
| External sharing (clients/partners) | — | Yes |

## Publish approvals (Teams)

Workspace owners and admins set a `public_publish_policy`:

| Policy | Behaviour |
| --- | --- |
| `allow` | Default. Members publish to open visibility freely. |
| `prohibit` | Members cannot go open; artifact stays `workspace`-visible. |
| `require_approval` | Held at `workspace` until **N** nominated approvers approve (1–10). |

Approval is pinned to the artifact's **content hash** — if the HTML changes after
approval, the next publish needs a fresh round. Re-publishing unchanged content
does not. Platform AI moderation still runs on top once approved.

Full flow: [Publishing artifacts → Workspace publish governance](/guides/publishing/#workspace-publish-governance).

## Audit log (Teams)

An append-only, per-workspace trail, visible to `admin`/`owner`:

```http
GET /v1/workspaces/{id}/audit?limit=100
```

Covers member add/remove, bulk invite, ownership transfer, visibility changes,
subdomain enable/disable, membership-policy changes, connection create/delete,
and session-policy changes. Retained for **one year**.

Full reference: [Workspace admin → Audit log](/teams/admin/#audit-log).

## AI moderation (all plans)

Every artifact that goes to `public` visibility — on any plan — passes an
automated safety review before it serves:

- An **AI content classifier** checks for phishing, malware, scams, and illegal content.
- A **URL-reputation check** scans outbound links and embedded resources.

| Outcome | Result |
| --- | --- |
| Approved | Goes live immediately. |
| Pending | Held **private** until cleared (fail-safe). Re-checked automatically within about an hour; goes public by itself once approved. Owners see **Under review** badges; visitors see a dedicated review page. |
| Blocked | Not served. |

This is a platform-wide protection, not a per-workspace setting — Free and Teams
get the same review. Full detail: [Public artifacts policy](/public-artifacts/overview/).

## Visibility model

Nothing is public by accident. Every artifact has one explicit visibility, and
only you (or a collaborator with rights) can change it:

| Visibility | Who can open it |
| --- | --- |
| `private` | You, and people you explicitly share with. |
| `workspace` | Members of the artifact's workspace. |
| `public` | Anyone with the link — the only visibility open to the anonymous internet. |

Full detail: [Public artifacts policy → Visibility levels](/public-artifacts/overview/#visibility-levels).

## Free plan member cap

Personal (free) workspaces cap membership at **3 members**. Teams workspaces are
unlimited. See [Teams overview → Seats](/teams/overview/#seats).

## Credential handling

Workspace data-connector credentials (API keys, OAuth tokens) are encrypted at
rest with **AES-256-GCM**, proxied server-side through the Worker, and never sent
to the browser — the artifact calls the connector by name, and the Worker injects
the credential on the outbound request. This is identical on every plan; Teams
doesn't get a stronger encryption tier, it gets more people who can manage the
connection. See [Workspace connections](/teams/connections/).

## Rate limits

Platform-wide, applied per account or per IP:

| Action | Limit |
| --- | --- |
| Publish | 30 / hour |
| AI chat | 100 / hour |
| Anonymous requests | 100 / minute per IP |

<Aside type="tip">
Related: [Public artifacts policy](/public-artifacts/overview/) for the full
moderation and abuse-handling flow, [Access policy](/spec/access-policy/) for
row-level data filtering, [Your data is portable](/guides/data-portability/)
for export and exit, the public [Security & Trust](https://shareout.site/security)
page for subprocessors, encryption, and trust-center detail, and the live
[Platform status](https://shareout.site/status) page (24h/7d/30d/90d uptime +
30-day daily table — no sign-in required).
</Aside>
