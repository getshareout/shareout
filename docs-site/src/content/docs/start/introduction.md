---
title: Introduction
description: What ShareOut is and how the API fits together on your instance.
---

ShareOut turns an idea into a live web page on **your** self-hosted instance. You
send files, you get a URL. From there, the same page can hold data, take uploads,
send email, and run on a schedule — all through one REST API.

No instance yet? [Install / self-host](/self-host/overview/) first.

## The core idea: an artifact

Everything you publish is an **artifact** — a versioned bundle of files served at
a live URL.

- **Files** — HTML, CSS, JS, images. The entrypoint is `index.html` by default.
- **Versions** — every publish creates a new version. Roll forward, never lose history.
- **Visibility** — `private`, `workspace`, or `public` (anyone on the internet with the link).
- **Data** — each artifact has its own JSON store, tables, and file blobs.
- **Jobs** — scheduled or event-driven tasks attached to the artifact.

## What you can do over the API

| You want to… | Endpoint |
| --- | --- |
| Publish or update a page | [`POST /v1/publish`](/api/operations/publishartifact/) |
| List and manage artifacts | [`/v1/artifacts`](/api/operations/listartifacts/) |
| Read or write artifact data | [`/v1/data/{id}/json`](/api/operations/getjson/) |
| Store files | [`/v1/data/{id}/blobs`](/api/operations/listblobs/) |
| Schedule a task | [`/v1/jobs`](/api/operations/createjob/) |
| Share with collaborators | [`/v1/artifacts/{id}/collaborators`](/api/operations/listcollaborators/) |

## Base URL

Use **your** instance origin (`$ORIGIN`) — the workers.dev URL or custom domain
from install. There is no public ShareOut API host.

```bash
# from ~/.shareout/credentials → "origin", or:
export SHAREOUT_ORIGIN=https://shareout.<your-account>.workers.dev
```

Ready to publish your first page? Head to the [Quickstart](/start/quickstart/).
