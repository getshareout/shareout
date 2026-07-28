---
title: Files (workspace assets)
description: Embed workspace files across artifacts by their stable deliverable id.
---

import { Aside } from '@astrojs/starlight/components';

**Workspace files** live in the Assets library (`dlv_*` ids). Unlike
[`sdk.blobs`](/sdk/blobs/) — which are private to one artifact — files are
first-class workspace objects you can reference from any page.

## Methods

```typescript
getUrl(deliverableId: string): string
```

Returns the content URL for a file by its `dlv_` id (always the **latest**
version):

```
https://shareout.site/v1/files/dlv_abc123/content
```

## Example

```javascript
const sdk = await ShareOut.create();

// Logo stored once in Assets, used on every dashboard
const logoUrl = sdk.files.getUrl('dlv_abc123');
document.querySelector('#logo').src = logoUrl;
```

## Visibility

| File visibility | Who can fetch the URL |
| --- | --- |
| `workspace` (default) | Anyone — embeddable in pages and delivery links |
| `private` | Owner, workspace members (read), or sharees with a file/folder grant |

Private files return **403** on the file content route for everyone else. The
older per-bucket blob URL also refuses private file bytes — always use
`sdk.files.getUrl()` for workspace files.

<Aside type="tip">
Upload and manage files from Home → **Assets**, or via
[`/v1/workspaces/{id}/assets`](/teams/api/#assets-deliverables). See
[Files & deliverables](/everyone/assets/) for folders, versions, comments, and
client delivery.
</Aside>
