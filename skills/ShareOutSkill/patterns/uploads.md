# Pattern: File Uploads

Copy-paste patterns for file upload functionality. API details: [SDK: Blobs](../sdk/blobs.md).

`sdk.blobs.upload(file)` resolves to `{ id, filename, mimeType, sizeBytes, createdAt }` — there is no
`url` field. Build a display URL from the id with `sdk.blobs.getUrl(id)` (Worker-proxied, fine for
`<img src>`) or `await sdk.blobs.getDownloadUrl(id)` (short-lived, direct from R2; prefer for large media).

## Basic Image Upload

Store the blob ids in `sdk.json` and paint the gallery from them.

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "json": { "uploadedImages": { "default": [] } }
  }
}
</script>

<input type="file" id="upload" accept="image/*">
<div id="preview"></div>
<p id="upload-status" role="status"></p>

<script type="module">
  const sdk = await ShareOut.create();
  const preview = document.getElementById('preview');

  async function render() {
    const images = (await sdk.json.get('uploadedImages')) || [];
    preview.replaceChildren(...images.map(({ id }) => {
      const img = document.createElement('img');
      img.src = sdk.blobs.getUrl(id);
      img.style.maxWidth = '200px';
      return img;
    }));
  }

  document.getElementById('upload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const blob = await sdk.blobs.upload(file);
    const images = (await sdk.json.get('uploadedImages')) || [];
    images.push({ id: blob.id, filename: blob.filename });
    await sdk.json.set('uploadedImages', images);
    await render();
  });

  render();
</script>
```

## Drag & Drop Upload

```html
<div id="drop-zone">
  Drop files here or <label><input type="file" id="browse" multiple>browse</label>
</div>
<p id="upload-status" role="status"></p>

<style>
  #drop-zone {
    border: 2px dashed #ccc; padding: 2rem; text-align: center;
    border-radius: 8px; transition: all 0.2s;
  }
  #drop-zone.dragover { border-color: #0066cc; background: #f0f7ff; }
  #drop-zone input { display: none; }
  #drop-zone label { color: #0066cc; cursor: pointer; }
</style>

<script type="module">
  const sdk = await ShareOut.create();
  const zone = document.getElementById('drop-zone');
  const status = document.getElementById('upload-status');

  async function uploadFiles(files) {
    for (const file of files) {
      try {
        const blob = await sdk.blobs.upload(file);
        status.textContent = `Uploaded ${blob.filename}`;
      } catch (err) {
        status.textContent = `Could not upload ${file.name}: ${err.message}`;
      }
    }
  }

  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    uploadFiles(e.dataTransfer.files);
  });
  document.getElementById('browse').addEventListener('change', (e) => uploadFiles(e.target.files));
</script>
```

## Upload Status

`sdk.blobs.upload()` does not report progress (no `onProgress` option). Show a busy state while
the promise is pending.

```html
<input type="file" id="file-input">
<progress id="upload-busy" hidden></progress>
<p id="upload-status" role="status"></p>

<script type="module">
  const sdk = await ShareOut.create();
  const busy = document.getElementById('upload-busy');
  const status = document.getElementById('upload-status');

  document.getElementById('file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    busy.hidden = false;
    try {
      const blob = await sdk.blobs.upload(file);
      status.textContent = `Uploaded ${blob.filename} (${Math.round(blob.sizeBytes / 1024)} KB)`;
    } catch (err) {
      status.textContent = `Upload failed: ${err.message}`;
    } finally {
      busy.hidden = true;
    }
  });
</script>
```

## Storage Usage

`sdk.blobs.getStorageUsage()` returns `{ usedBytes, blobCount, maxBytes, maxBlobs, availableBytes }`.

```html
<div class="storage-info">
  <span>Storage: <span id="storage-used">0</span> / <span id="storage-limit">0</span> MB</span>
  <progress id="storage-bar" max="1" value="0"></progress>
</div>

<script type="module">
  const sdk = await ShareOut.create();
  const { usedBytes, maxBytes } = await sdk.blobs.getStorageUsage();
  document.getElementById('storage-used').textContent = (usedBytes / 1024 / 1024).toFixed(1);
  document.getElementById('storage-limit').textContent = (maxBytes / 1024 / 1024).toFixed(0);
  document.getElementById('storage-bar').value = usedBytes / maxBytes;
</script>
```

## Related

- [Overview](overview.md) - All patterns
- [SDK: Blobs](../sdk/blobs.md) - Blob methods
- [API: Blobs](../api/blobs.md) - REST endpoints
