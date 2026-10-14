/** Markdown inline editing: block model + HTML→Markdown (pure; no other client globals). */
// The server cuts the source into blocks and renders each one (src/editor/markdown-edit.ts).
// mdBuild stamps every top-level element with its block index; mdPrepare locks blocks the
// serializer cannot reproduce; mdFromDoc keeps untouched/locked blocks byte-for-byte and
// re-serializes only edited ones — so a save can never rewrite text nobody touched.
export const workspace_client_md_edit_JS = `  // ===== Markdown inline edit =====
  var MD_BLOCK_RE = /^(P|H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE|HR|LI|DIV)$/;
  var MD_LIST_RE = /^(UL|OL)$/;
  function mdRoot(doc) { return doc.querySelector('[data-md-root]') || doc.body; }
  function mdBuild(doc, M) {
    var root = mdRoot(doc);
    M.blocks.forEach(function (b, i) {
      if (b.hidden) return;
      var box = doc.createElement('div'); box.innerHTML = b.html;
      var run = null;
      [].slice.call(box.childNodes).forEach(function (n) {
        if (n.nodeType === 1 && MD_BLOCK_RE.test(n.tagName)) { run = null; n.setAttribute('data-md-b', String(i)); root.appendChild(n); return; }
        if (n.nodeType !== 1 && n.nodeType !== 3) return;
        if (n.nodeType === 3 && !run && !n.nodeValue.trim()) return;
        if (!run) { run = doc.createElement('span'); run.setAttribute('data-md-b', String(i)); run.setAttribute('data-md-inline', ''); root.appendChild(run); }
        run.appendChild(n);
      });
      root.appendChild(doc.createTextNode('\\n'));
    });
  }
  function mdInline(node, skip) {
    var out = '';
    for (var c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { out += c.nodeValue.replace(/\\u00a0/g, ' '); continue; }
      if (c.nodeType !== 1) continue;
      var tag = c.tagName, inner;
      if (skip && skip.test(tag)) continue;
      if (tag === 'BR') out += '\\n';
      else if (tag === 'INPUT') continue;
      else if (tag === 'CODE') out += '\\u0060' + c.textContent + '\\u0060';
      else if (tag === 'IMG') out += '![' + (c.getAttribute('alt') || '') + '](' + (c.getAttribute('src') || '') + ')';
      else if (tag === 'A') { inner = mdInline(c); out += c.getAttribute('href') ? '[' + inner + '](' + c.getAttribute('href') + ')' : inner; }
      else if (tag === 'STRONG' || tag === 'B') { inner = mdInline(c); out += inner.trim() ? '**' + inner + '**' : inner; }
      else if (tag === 'EM' || tag === 'I') { inner = mdInline(c); out += inner.trim() ? '*' + inner + '*' : inner; }
      else if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') { inner = mdInline(c); out += inner.trim() ? '~~' + inner + '~~' : inner; }
      else if (tag === 'P' || tag === 'DIV') out += '\\n' + mdInline(c);
      else out += mdInline(c);
    }
    return out;
  }
  function mdList(el, pad, ind) {
    var ol = el.tagName === 'OL', n = ol ? (parseInt(el.getAttribute('start') || '1', 10) || 1) : 0, lines = [];
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (MD_LIST_RE.test(c.tagName)) { lines.push(mdList(c, pad + ind, ind)); continue; }
      var mark = ol ? (n++) + '. ' : '- ', subs = [];
      for (var k = c.firstElementChild; k; k = k.nextElementSibling) {
        if (k.tagName === 'INPUT' && k.getAttribute('type') === 'checkbox' && !ol) mark += k.hasAttribute('checked') ? '[x] ' : '[ ] ';
        if (MD_LIST_RE.test(k.tagName)) subs.push(mdList(k, pad + ind, ind));
      }
      lines.push(pad + mark + mdInline(c, MD_LIST_RE).trim());
      lines.push.apply(lines, subs);
    }
    return lines.join('\\n');
  }
  function mdTable(el) {
    var rows = [].slice.call(el.querySelectorAll('tr'));
    if (!rows.length) return '';
    function row(tr) { return '| ' + [].slice.call(tr.children).map(function (td) { return mdInline(td).trim(); }).join(' | ') + ' |'; }
    var head = rows[0].children.length, sep = [];
    for (var i = 0; i < head; i++) sep.push('---');
    return [row(rows[0]), '| ' + sep.join(' | ') + ' |'].concat(rows.slice(1).map(row)).join('\\n');
  }
  function mdBlockOf(el, ind) {
    var tag = el.tagName, m = /^H([1-6])$/.exec(tag);
    if (m) return '######'.slice(0, +m[1]) + ' ' + mdInline(el).trim();
    if (MD_LIST_RE.test(tag)) return mdList(el, '', ind);
    if (tag === 'BLOCKQUOTE') return mdInline(el).split('\\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) { return '> ' + l; }).join('\\n');
    if (tag === 'PRE') {
      var code = el.querySelector('code'), lang = code && /language-(\\S+)/.exec(code.className || '');
      return '\\u0060\\u0060\\u0060' + (lang ? lang[1] : '') + '\\n' + (el.textContent || '').replace(/\\n+$/, '') + '\\n\\u0060\\u0060\\u0060';
    }
    if (tag === 'TABLE') return mdTable(el);
    if (tag === 'HR') return '---';
    if (tag === 'IMG') return '![' + (el.getAttribute('alt') || '') + '](' + (el.getAttribute('src') || '') + ')';
    if (tag === 'LI') return '- ' + mdInline(el).trim();
    return mdInline(el).trim();
  }
  function mdGroup(els, ind) { return els.map(function (e) { return mdBlockOf(e, ind); }).filter(function (s) { return s !== ''; }).join('\\n'); }
  // Render-equivalent spellings the serializer normalizes (marker style, numbering, spacing).
  function mdNorm(s) {
    return s.split('\\n').map(function (l) {
      l = l.replace(/\\t/g, '    ').replace(/\\s+$/, '');
      l = l.replace(/^(\\s*)[*+](?=\\s)/, '$1-').replace(/^(\\s*)\\d+\\.(?=\\s)/, function (_, w) { return w + '1.'; });
      l = l.replace(/^(#{1,6})\\s+/, '$1 ').replace(/^(\\*\\*\\*|___)$/, '---');
      if (/^\\|.*\\|$/.test(l)) l = '|' + l.slice(1, -1).split('|').map(function (c) { c = c.trim(); return /^-+$/.test(c) ? '---' : c; }).join('|') + '|';
      l = l.replace(/(^|[^A-Za-z0-9_])__([^_]+)__(?![A-Za-z0-9_])/g, '$1**$2**').replace(/(^|[^A-Za-z0-9_])_([^_]+)_(?![A-Za-z0-9_])/g, '$1*$2*');
      return l;
    }).join('\\n');
  }
  function mdBlockEls(doc, i) { return [].slice.call(mdRoot(doc).children).filter(function (e) { return e.getAttribute('data-md-b') === String(i); }); }
  function mdPrepare(doc, M) {
    var locked = 0;
    M.blocks.forEach(function (b, i) {
      if (b.hidden) return;
      var els = mdBlockEls(doc, i);
      b.orig = mdGroup(els, M.indent);
      b.lock = mdNorm(b.orig) !== mdNorm(b.src);
      if (b.lock) { locked++; els.forEach(function (e) { e.setAttribute('data-md-lock', ''); }); }
    });
    return locked;
  }
  function mdFromDoc(doc, M) {
    var parts = [], seen = {}, kids = mdRoot(doc).children, k = 0;
    var first = M.blocks[0];
    if (first && first.hidden) parts.push({ text: first.src, sep: first.sep, keep: true });
    while (k < kids.length) {
      var b = kids[k].getAttribute('data-md-b'), grp = [kids[k++]];
      if (b != null) while (k < kids.length && kids[k].getAttribute('data-md-b') === b) grp.push(kids[k++]);
      var blk = b != null && !seen[b] ? M.blocks[+b] : null;
      if (b != null) seen[b] = 1;
      var text = blk && (blk.lock || mdGroup(grp, M.indent) === blk.orig) ? blk.src : mdGroup(grp, M.indent);
      if (text) parts.push({ text: text, sep: blk ? blk.sep : '' });
    }
    var tail = M.blocks.length ? M.blocks[M.blocks.length - 1].sep : '\\n';
    return M.lead + parts.map(function (p, i) {
      if (i === parts.length - 1) return p.text + tail;
      return p.text + (p.keep || (p.sep.match(/\\n/g) || []).length >= 2 ? p.sep : '\\n\\n');
    }).join('');
  }

`;
