---
title: Workspace homepage
description: What visitors see at {workspace}.shareout.site — membership gate and artifact URLs.
---

When a [custom subdomain](/teams/subdomain/) is enabled, `{workspace}.shareout.site`
behaves differently at the **root** vs **artifact paths**.

## Subdomain root (`/`)

The workspace root is **never a public gallery**. It is membership-gated:

| Visitor | What happens |
| --- | --- |
| **Workspace member** | Redirect to Home scoped to this workspace (`/home?workspace=…`) |
| **Signed in, not a member** | "This workspace is private" page with option to switch accounts |
| **Anonymous** | Redirect to sign in, returning to this subdomain after OAuth |

Workspaces are closed surfaces — only members reach the dashboard from the root.

## Artifact URLs

Individual pages stay shareable at clean subdomain URLs:

```
https://{workspace}.shareout.site/{artifact-slug}/
```

`workspace`-visible and `public` artifacts published into the workspace are
reachable here (subject to each artifact's visibility and access policy). Private
artifacts require the usual collaborator or access rules.

## Namespaced alternative

If the subdomain is not enabled, workspace artifacts are also reachable at:

```
shareout.site/@{workspaceSlug}/{artifact-slug}/
```

## Related

- [Subdomains](/teams/subdomain/) — enable `{workspace}.shareout.site`
- [Folders](/teams/folders/) — organize artifacts
- [Workspaces](/teams/workspaces/) — branding and membership
