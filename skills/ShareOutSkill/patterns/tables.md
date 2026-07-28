# Pattern: Data Tables

Copy-paste patterns for displaying tabular data.

## Basic Table with Binding

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "tables": {
      "items": {
        "schema": [
          { "name": "id", "type": "string", "primary": true },
          { "name": "name", "type": "string" },
          { "name": "status", "type": "string" }
        ]
      }
    }
  }
}
</script>

<table>
  <thead>
    <tr><th>Name</th><th>Status</th><th>Actions</th></tr>
  </thead>
  <tbody data-shareout-binding="table:items" data-shareout-template="row">
    <tr data-template="row">
      <td data-shareout-binding="field:name"></td>
      <td data-shareout-binding="field:status"></td>
      <td><button onclick="deleteItem(this)">Delete</button></td>
    </tr>
  </tbody>
</table>

<script>
  const sdk = new ShareOut();
  const items = sdk.table('items');

  async function deleteItem(btn) {
    const row = btn.closest('tr');
    const id = row.dataset.id;
    await items.delete(id);
  }
</script>
```

## Sortable Table

```html
<table id="sortable-table">
  <thead>
    <tr>
      <th data-sort="name" onclick="sortBy('name')">Name ↕</th>
      <th data-sort="date" onclick="sortBy('date')">Date ↕</th>
    </tr>
  </thead>
  <tbody data-shareout-binding="table:items"></tbody>
</table>

<script>
  let sortField = 'name';
  let sortDir = 'asc';

  async function sortBy(field) {
    sortDir = (sortField === field && sortDir === 'asc') ? 'desc' : 'asc';
    sortField = field;
    const { rows } = await items.query({ orderBy: field, order: sortDir });
    renderTable(rows);
  }
</script>
```

## Paginated Table

```html
<div data-shareout-binding="table:items" data-shareout-pagination="true">
  <table>
    <tbody data-shareout-template="row"></tbody>
  </table>
  <div class="pagination">
    <button onclick="prevPage()">Previous</button>
    <span data-shareout-binding="pagination:info"></span>
    <button onclick="nextPage()">Next</button>
  </div>
</div>

<script>
  const PAGE_SIZE = 10;
  let currentPage = 0;

  async function loadPage(page) {
    const { rows, total } = await items.query({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE
    });
    currentPage = page;
    renderTable(rows);
    updatePagination(total);
  }
</script>
```

## Related

- [Overview](overview.md) - All patterns
- [SDK: Table](../sdk/table.md) - Table methods
- [Bindings](../core/html-spec/bindings.md) - Binding syntax
