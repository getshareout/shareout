/**
 * Sortable tables: clicking a column header sorts the rows A→Z (smallest first), clicking
 * it again Z→A. One delegated listener covers every <table> with a <thead> and every div
 * table (.wsx-tbl__head followed by its rows) on a page, including tables rendered later,
 * so a new table sorts without any wiring. Loaded on every platform page by
 * renderHtmlPage(); not by the artifact viewer.
 *
 * A cell's data-sort (else data-date) is compared instead of its text: put the raw value
 * there when the text is relative or localized ("2d ago"). Numbers compare as numbers
 * ("1,234", "$3.40", "1.2k", "4.5 MB", "120 ms", "12%"); text compares ignoring case and
 * accents, with digit runs as numbers; blank cells ("" or "—") stay last both ways.
 * The sorted header gets aria-sort, which draws the arrow.
 *
 * Opt out with data-nosort on a header cell or on the table. A view that keeps its own sort
 * state (re-renders sorted from its data, or sorts on the server) marks its header row
 * data-sort-own and sets aria-sort itself.
 */

export const tableSortClasses = `
table:not([data-nosort]) > thead th:not(:empty):not([data-nosort]),
.wsx-tbl__head > :not(:empty):not([data-nosort]) { cursor: pointer; user-select: none; }
[aria-sort="ascending"]::after { content: " \\25B2"; font-size: .8em; }
[aria-sort="descending"]::after { content: " \\25BC"; font-size: .8em; }
`;

export const tableSortScript = `
(function() {
  if (window.soTableSort) return;
  window.soTableSort = true;
  var UNIT = { '': 1, '%': 1, ms: 1, b: 1, k: 1e3, m: 1e6, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 };
  function num(s) {
    var m = /^([-+]?)[$\\u20ac\\u00a3]?\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*([a-z%]*)$/i.exec(s);
    if (!m || !(m[3].toLowerCase() in UNIT)) return NaN;
    return (m[1] === '-' ? -1 : 1) * parseFloat(m[2].replace(/,/g, '')) * UNIT[m[3].toLowerCase()];
  }
  function compare(a, b) {
    a = a == null ? '' : String(a).trim(); b = b == null ? '' : String(b).trim();
    var x = num(a), y = num(b);
    if (x === x && y === y) return x - y;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }
  function blank(s) { return s === '' || s === '\\u2014'; }
  function val(c) {
    if (!c) return '';
    var v = c.getAttribute('data-sort');
    if (v == null) v = c.getAttribute('data-date');
    return (v == null ? c.textContent : v).trim();
  }
  function sortBy(cell) {
    var head = cell.parentNode;
    var i = Array.prototype.indexOf.call(head.children, cell);
    var dir = cell.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
    Array.prototype.forEach.call(head.children, function(c) { c.removeAttribute('aria-sort'); });
    cell.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending');
    var groups = head.tagName === 'TR' ? Array.prototype.slice.call(head.closest('table').tBodies) : [head.parentNode];
    groups.forEach(function(g) {
      Array.prototype.filter.call(g.children, function(r) { return r !== head; })
        .map(function(r) { return { r: r, v: val(r.children[i]) }; })
        .sort(function(p, q) { var bp = blank(p.v), bq = blank(q.v); return bp || bq ? bp - bq : dir * compare(p.v, q.v); })
        .forEach(function(p) { g.appendChild(p.r); });
    });
  }
  document.addEventListener('click', function(e) {
    var cell = e.target.closest && e.target.closest('thead th, .wsx-tbl__head > *');
    if (!cell || !cell.textContent.trim() || cell.closest('[data-nosort]') || cell.parentNode.hasAttribute('data-sort-own')) return;
    var ctl = e.target.closest('a, button, input, select, label');
    if (ctl && cell.contains(ctl)) return;
    sortBy(cell);
  });
})();
`;
