# SDK Files (workspace assets)

**Workspace files** live in the Assets library (`dlv_*` ids). Unlike [blobs](blobs.md) — which are private to one artifact — files are first-class workspace objects you can reference from any page.

## Methods

```typescript
getUrl(deliverableId: string): string
```

Returns the content URL for a file by its `dlv_` id (always the **latest** version):

```
$ORIGIN/v1/files/dlv_abc123/content
```

Inside a published artifact, prefer a relative path when same-origin:

```javascript
sdk.files.getUrl('dlv_abc123')  // → /v1/files/dlv_abc123/content
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
| `workspace` (personal-library default) | Anyone — embeddable in pages and delivery links |
| `team` (workspace upload default) | Signed-in internal workspace members, the owner, or sharees with a direct file grant |
| `private` | Owner, or sharees with a direct file grant |

`team` and `private` files return **403** on the file content route for everyone else — including a published artifact's anonymous viewers, so set a file to `workspace` before embedding it. The older per-bucket blob URL also refuses private file bytes — always use `sdk.files.getUrl()` for workspace files.

## Related

- [../team/assets.md](../team/assets.md) — upload, folders, versions, comments, client delivery
- [blobs.md](blobs.md) — per-artifact file storage (not workspace-scoped)
- [overview.md](overview.md) — SDK loading and manifest
