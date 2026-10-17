---
title: Templates
description: Save a page or a whole folder as a template and install it in any workspace in one click — without bringing along the original workspace's data.
---

Built something for one team or client that another one needs too? Save it as a
**template**. Anyone who can use the template installs it in their workspace in one click
and gets their own copy, ready to connect to their own data.

## Save as template

Open a page and choose **Save as template** in its details panel, or open a folder and
use **Save as template** in the folder bar. Before anything is saved you see:

- **Included** — the pages and their files (every page of a multi-page site), the folder
  structure and guides, and the *shape* of the data: table and dataset columns, and which
  data sources it uses.
- **Left behind** — table rows, dataset contents, saved values, comments, views,
  Knowledge and credentials. Credentials found in the code are removed automatically.
- **Check before saving** — anything that looks personal or specific to your workspace
  (emails, phone numbers, your workspace's name, people in it). Tick the box once you've
  checked it, or edit the page first.

You can keep up to five example rows per table, so the copy doesn't open empty.

## Who can use a template

| Choice | Who can install it |
|---|---|
| This workspace | Members of the workspace it was made in |
| Shared | Also the workspaces you share it with (you must belong to them) |
| Library | Every workspace on this ShareOut — only instance admins can publish here |

## Install

Open **Templates** in the sidebar (or **New → Browse templates**), preview one, and
choose **Install**. Pick a folder, and ShareOut:

- creates the pages (and folders, for a folder template) — always new copies, never over
  something you already have
- fixes the links between them so they point at your copies
- creates the tables and datasets empty, with the same columns
- shows **Finish setup**: the data sources to connect (use the same name) and the tables
  to fill

## Updates

When the template gets a new version, its installed pages show **Update available** in
their details. **Review update** lists what changes; **Update** gives each page a new
version with the template's files. Earlier versions stay in History, so you can restore
one, and your data is not touched.

## From an agent or the API

The MCP tools `list_templates`, `install_template` and `save_as_template` work from
Claude or ChatGPT, and the REST API lives under `/v1/artifact-templates` — see the
[API reference](/teams/api/).
