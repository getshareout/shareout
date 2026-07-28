# ShareOut UI — JavaScript API

Behavior for interactive components. Load both the stylesheet and the script:

```html
<link rel="stylesheet" href="$ORIGIN/sdk/shareout.css">
<script src="$ORIGIN/sdk/shareout-ui.js" defer></script>
```

Everything is on `window.ShareOutUI`. No build step, no dependencies. Tabs and dropdowns (using the markup in [classes.md](classes.md)) auto-initialize on load.

## Toast

```js
ShareOutUI.toast('Saved!');
ShareOutUI.toast('Could not save', { type: 'error' });   // success | warning | error
ShareOutUI.toast('Heads up', { type: 'warning', duration: 5000 });
```

Toasts stack bottom-center and auto-dismiss (default 3s).

## Modal

```js
// pass an HTML string or a DOM node
ShareOutUI.modal('<h3 class="so-card-title">Confirm</h3><p>Delete this page?</p>' +
  '<div class="so-row"><button class="so-btn so-btn-secondary" onclick="ShareOutUI.closeModal()">Cancel</button>' +
  '<button class="so-btn so-btn-primary">Delete</button></div>');

ShareOutUI.closeModal();   // also closes on backdrop click or Escape
```

## Copy to clipboard

```js
const ok = await ShareOutUI.copy('$ORIGIN/a/my-page');
if (ok) ShareOutUI.toast('Link copied');
```

## Chart colors

Returns the brand-safe series palette (`--so-chart-1`…`8`) for any chart library:

```js
const colors = ShareOutUI.chartColors();   // ['#2563eb', '#16a34a', ...]

new Chart(ctx, {
  type: 'bar',
  data: { labels, datasets: [{ data, backgroundColor: colors }] },
});
```

## Re-initialize after dynamic DOM changes

If you inject tabs/dropdowns after page load, re-run init on the new subtree:

```js
container.innerHTML = newMarkup;
ShareOutUI.init(container);   // or ShareOutUI.init() for the whole document
```

## API summary

| Method | Purpose |
|--------|---------|
| `ShareOutUI.toast(msg, opts?)` | Transient notification |
| `ShareOutUI.modal(htmlOrNode)` | Open a modal dialog |
| `ShareOutUI.closeModal()` | Close the open modal |
| `ShareOutUI.copy(text)` | Copy to clipboard → `Promise<boolean>` |
| `ShareOutUI.chartColors()` | Brand chart palette → `string[]` |
| `ShareOutUI.init(root?)` | (Re)initialize tabs & dropdowns |
