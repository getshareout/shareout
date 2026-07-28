# Pattern: File Uploads

Copy-paste patterns for file upload functionality.

## Basic Image Upload

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "json": { "uploadedImages": { "default": [] } }
  }
}
</script>

<input type="file" id="upload" accept="image/*" onchange="uploadFile(this)">
<div id="preview" data-shareout-binding="json:uploadedImages" data-shareout-template="img">
  <img data-template="img" data-shareout-binding="attr:src=url" style="max-width: 200px">
</div>

<script>
  const sdk = new ShareOut();

  async function uploadFile(input) {
    const file = input.files[0];
    if (!file) return;

    const blob = await sdk.blobs.upload(file);
    const images = await sdk.json.get('uploadedImages') || [];
    images.push({ url: blob.url, id: blob.id });
    await sdk.json.set('uploadedImages', images);
  }
</script>
```

## Drag & Drop Upload

```html
<div id="drop-zone"
     ondragover="event.preventDefault(); this.classList.add('dragover')"
     ondragleave="this.classList.remove('dragover')"
     ondrop="handleDrop(event)">
  Drop files here or <label><input type="file" multiple onchange="uploadFiles(this.files)">browse</label>
</div>

<style>
  #drop-zone {
    border: 2px dashed #ccc; padding: 2rem; text-align: center;
    border-radius: 8px; transition: all 0.2s;
  }
  #drop-zone.dragover { border-color: #0066cc; background: #f0f7ff; }
  #drop-zone input { display: none; }
  #drop-zone label { color: #0066cc; cursor: pointer; }
</style>

<script>
  async function handleDrop(e) {
    e.preventDefault();
    e.target.classList.remove('dragover');
    await uploadFiles(e.dataTransfer.files);
  }

  async function uploadFiles(files) {
    for (const file of files) {
      const blob = await sdk.blobs.upload(file);
      console.log('Uploaded:', blob.url);
    }
  }
</script>
```

## Upload with Progress

```html
<div class="upload-area">
  <input type="file" id="file-input" onchange="uploadWithProgress(this.files[0])">
  <div id="progress-bar" style="display:none">
    <div id="progress-fill" style="width:0%"></div>
  </div>
</div>

<script>
  async function uploadWithProgress(file) {
    const progressBar = document.getElementById('progress-bar');
    const progressFill = document.getElementById('progress-fill');

    progressBar.style.display = 'block';

    // Simulate progress (actual progress depends on SDK implementation)
    const blob = await sdk.blobs.upload(file, {
      onProgress: (percent) => {
        progressFill.style.width = percent + '%';
      }
    });

    progressFill.style.width = '100%';
    setTimeout(() => progressBar.style.display = 'none', 1000);
  }
</script>
```

## Storage Info

```html
<div class="storage-info">
  <span>Storage: <span id="storage-used">0</span> / <span id="storage-limit">500</span> MB</span>
  <div class="storage-bar">
    <div id="storage-fill" style="width:0%"></div>
  </div>
</div>

<script>
  async function loadStorageInfo() {
    const info = await sdk.blobs.getStorageInfo();
    const usedMB = (info.used / 1024 / 1024).toFixed(1);
    const limitMB = (info.limit / 1024 / 1024).toFixed(0);
    document.getElementById('storage-used').textContent = usedMB;
    document.getElementById('storage-limit').textContent = limitMB;
    document.getElementById('storage-fill').style.width = (info.used / info.limit * 100) + '%';
  }
</script>
```

## Related

- [Overview](overview.md) - All patterns
- [SDK: Blobs](../sdk/blobs.md) - Blob methods
- [API: Blobs](../api/blobs.md) - REST endpoints
