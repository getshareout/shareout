import { frame } from '../frame';
import type { StarterArtifact } from '../types';

const head = `<style>
.ig-drop{border:1.5px dashed var(--so-border);border-radius:var(--so-radius);
  padding:32px 20px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s}
.ig-drop:hover,.ig-drop.over{border-color:var(--so-blue);background:var(--so-blue-light)}
.ig-drop strong{display:block;font-size:14px;margin-bottom:2px}
.ig-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-top:20px}
.ig-cell{position:relative;border:1px solid var(--so-border);border-radius:12px;overflow:hidden;
  aspect-ratio:1;background:var(--so-bg)}
.ig-cell img{width:100%;height:100%;object-fit:cover;display:block}
.ig-del{position:absolute;top:6px;right:6px;width:26px;height:26px;border:0;cursor:pointer;
  border-radius:8px;background:rgba(28,25,23,.62);color:#fff;font-size:15px;line-height:1;
  display:none;place-items:center}
.ig-cell:hover .ig-del{display:grid}
.ig-empty{border:1px solid var(--so-border);border-radius:var(--so-radius);padding:36px 20px;
  text-align:center;color:var(--so-ink-3);margin-top:20px}
</style>`;

const body = `
<div class="so-card">
  <h2>Add images</h2>
  <div class="ig-drop" id="drop">
    <strong>Drop images here, or click to choose</strong>
    <span class="so-muted">PNG, JPG, GIF, WebP — image files only</span>
  </div>
  <input type="file" id="file" accept="image/*" multiple style="display:none">
</div>
<div id="grid" class="ig-grid"></div>
<div id="empty" class="ig-empty">No images yet — drop a few above to start your gallery.</div>
<p class="so-muted" style="margin-top:16px">
  Files live on ShareOut (R2 object storage) via <code>so.blobs</code> — drop in photos, PDFs,
  anything, with no storage setup. Each upload returns an id you can list and display anywhere.
</p>`;

const script = `
  const drop = document.getElementById('drop');
  const fileInput = document.getElementById('file');
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');

  function isImage(f){ return f && f.type && f.type.indexOf('image/') === 0; }

  function addCell(meta){
    empty.style.display = 'none';
    const cell = document.createElement('div');
    cell.className = 'ig-cell';
    cell.dataset.id = meta.id;

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = meta.filename || 'image';
    img.src = so.blobs.getUrl(meta.id);
    cell.appendChild(img);

    const del = document.createElement('button');
    del.className = 'ig-del';
    del.type = 'button';
    del.title = 'Delete';
    del.textContent = '\\u00d7';
    del.addEventListener('click', async function(){
      del.disabled = true;
      await so.blobs.delete(meta.id);
      cell.remove();
      if(!grid.children.length) empty.style.display = '';
    });
    cell.appendChild(del);

    grid.appendChild(cell);
  }

  async function load(){
    const res = await so.blobs.list({ limit: 200 });
    const blobs = (res && res.blobs) || [];
    const images = blobs.filter(function(b){
      return b.mimeType && b.mimeType.indexOf('image/') === 0;
    });
    grid.innerHTML = '';
    if(!images.length){ empty.style.display = ''; return; }
    images.forEach(addCell);
  }

  async function upload(files){
    const list = Array.prototype.slice.call(files).filter(isImage);
    for(const f of list){
      const meta = await so.blobs.upload(f, { filename: f.name });
      addCell(meta);
    }
  }

  drop.addEventListener('click', function(){ fileInput.click(); });
  fileInput.addEventListener('change', async function(){
    await upload(fileInput.files);
    fileInput.value = '';
  });
  drop.addEventListener('dragover', function(e){ e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', function(){ drop.classList.remove('over'); });
  drop.addEventListener('drop', async function(e){
    e.preventDefault();
    drop.classList.remove('over');
    if(e.dataTransfer && e.dataTransfer.files) await upload(e.dataTransfer.files);
  });

  await load();`;

export const imageGallery: StarterArtifact = {
  slug: 'image-gallery',
  name: 'Image gallery',
  description: 'Drop images to upload, then browse them in a thumbnail grid — stored on ShareOut.',
  feature: 'so.blobs',
  tier: 'personal',
  html: frame({
    title: 'Image gallery',
    feature: 'so.blobs',
    description: 'Upload images to object storage and show them in a responsive grid.',
    head,
    body,
    script,
  }),
};
