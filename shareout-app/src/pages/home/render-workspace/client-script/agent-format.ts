/**
 * Pure text helpers for the agent dock: safe Markdown (also for partial, still-streaming
 * text) and the attachment marker the agent needs in the message text but the reader
 * should see as a file chip. No DOM access — unit-tested by evaluating this fragment.
 */
export const workspace_client_agent_format_JS = `  // ===== agent dock: text helpers (pure) =====
  function mdEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  // http(s), mailto and relative targets only, read the way a browser reads a scheme (references decoded, whitespace dropped).
  function mdSafeUrl(url) {
    var u = String(url).replace(/&#(x[0-9a-f]+|\\d+);?/gi, function (m, n) {
      var c = /^x/i.test(n) ? parseInt(n.slice(1), 16) : parseInt(n, 10);
      return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : '';
    }).replace(/&(colon|tab|newline);/gi, function (m, n) { return n.toLowerCase() === 'colon' ? ':' : ''; });
    var scheme = /^([a-z][a-z0-9+.-]*):/.exec(u.replace(/[\\u0000-\\u0020\\u007f]/g, '').toLowerCase());
    return !scheme || scheme[1] === 'http' || scheme[1] === 'https' || scheme[1] === 'mailto';
  }
  function mdLink(html, url) { return '<a href="' + mdEsc(url) + '" target="_blank" rel="noopener noreferrer">' + html + '</a>'; }
  function mdEmph(s) { return s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>').replace(/(^|[^*])\\*([^*\\n]+)\\*/g, '$1<em>$2</em>'); }
  // ----- safe Markdown: fenced code -> tables/headings/lists/quote/hr -> paragraphs, inline last -----
  // Code spans, links and bare URLs are cut from the raw text first, so each URL is escaped once, as an attribute value.
  function mdInline(t, linkText) {
    var BT = String.fromCharCode(96);
    var code = BT + '([^' + BT + ']+)' + BT;
    var re = new RegExp(linkText ? code : code + '|\\\\[([^\\\\]]+)\\\\]\\\\(([^)\\\\s]+)\\\\)|(^|\\\\s)(https?:\\\\/\\\\/[^\\\\s<]+)', 'g');
    var src = String(t == null ? '' : t).replace(/[\\u0001\\u0002]/g, '');
    var kept = [], text = '', last = 0, m;
    function keep(html) { kept.push(html); return '\\u0001' + (kept.length - 1) + '\\u0002'; }
    while ((m = re.exec(src))) {
      text += src.slice(last, m.index);
      if (m[1] != null) text += keep('<code>' + mdEsc(m[1]) + '</code>');
      else if (m[2] != null) text += mdSafeUrl(m[3]) ? keep(mdLink(mdInline(m[2], true), m[3])) : m[0];
      else text += m[4] + keep(mdLink(mdEsc(m[5]), m[5]));
      last = re.lastIndex;
    }
    text += src.slice(last);
    return mdEmph(mdEsc(text)).replace(/\\u0001(\\d+)\\u0002/g, function (x, i) { return kept[+i]; });
  }
  function mdToHtml(raw) {
    var BT = String.fromCharCode(96);
    var src = String(raw == null ? '' : raw);
    var blocks = [];
    var fence = new RegExp(BT + BT + BT + '[^\\n]*\\n([\\\\s\\\\S]*?)' + BT + BT + BT, 'g');
    src = src.replace(fence, function (m, code) { blocks.push(code); return '\\u0000C' + (blocks.length - 1) + '\\u0000'; });
    var lines = src.split('\\n'); var html = ''; var listType = null;
    function closeList() { if (listType) { html += '</' + listType + '>'; listType = null; } }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var cm = ln.trim().match(/^\\u0000C(\\d+)\\u0000$/);
      if (cm) { closeList(); html += '<pre class="wsx-pre"><code>' + mdEsc(blocks[+cm[1]]) + '</code></pre>'; continue; }
      if (/^\\s*$/.test(ln)) { closeList(); continue; }
      if (/^\\s*\\|.*\\|\\s*$/.test(ln) && /^\\s*\\|?\\s*:?-{2,}:?\\s*(\\|\\s*:?-{2,}:?\\s*)+\\|?\\s*$/.test(lines[i + 1] || '')) {
        closeList();
        var cells = function (r) { return r.trim().replace(/^\\|/, '').replace(/\\|$/, '').split('|').map(function (c) { return mdInline(c.trim()); }); };
        html += '<div class="wsx-tablewrap"><table class="wsx-table"><thead><tr>' + cells(ln).map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>';
        for (i += 2; i < lines.length && /^\\s*\\|/.test(lines[i]); i++) html += '<tr>' + cells(lines[i]).map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
        i--; html += '</tbody></table></div>'; continue;
      }
      var h = ln.match(/^(#{1,3})\\s+(.*)$/);
      if (h) { closeList(); var lvl = h[1].length + 2; html += '<h' + lvl + ' class="wsx-h">' + mdInline(h[2]) + '</h' + lvl + '>'; continue; }
      if (/^\\s*[-*]\\s+/.test(ln)) { if (listType !== 'ul') { closeList(); html += '<ul class="wsx-ul">'; listType = 'ul'; } html += '<li>' + mdInline(ln.replace(/^\\s*[-*]\\s+/, '')) + '</li>'; continue; }
      if (/^\\s*\\d+\\.\\s+/.test(ln)) { if (listType !== 'ol') { closeList(); html += '<ol class="wsx-ol">'; listType = 'ol'; } html += '<li>' + mdInline(ln.replace(/^\\s*\\d+\\.\\s+/, '')) + '</li>'; continue; }
      if (/^\\s*>\\s?/.test(ln)) { closeList(); html += '<blockquote class="wsx-bq">' + mdInline(ln.replace(/^\\s*>\\s?/, '')) + '</blockquote>'; continue; }
      if (/^\\s*---+\\s*$/.test(ln)) { closeList(); html += '<hr class="wsx-hr">'; continue; }
      closeList(); html += '<p>' + mdInline(ln) + '</p>';
    }
    closeList();
    return html;
  }
  // Partial text mid-stream: close a dangling code fence so the block renders as code
  // while it streams instead of flashing as raw backticks until the closing fence lands.
  function mdStreaming(raw) {
    var src = String(raw == null ? '' : raw);
    var fences = src.split(String.fromCharCode(96, 96, 96)).length - 1;
    return fences % 2 ? src + '\\n' + String.fromCharCode(96, 96, 96) : src;
  }
  // The agent reads attachments from a text marker; the reader sees a file chip instead.
  function attachMarker(name, id) { return '[Attached file: ' + String(name || 'file').replace(/[\\]\\n]/g, ' ') + ' \\u2014 file id ' + id + ']'; }
  function splitAttachments(text) {
    var files = [];
    var rest = String(text == null ? '' : text).replace(/\\n*\\[Attached file: ([^\\]\\n]*?) \\u2014 file id ([^\\]\\s]+)\\]/g, function (m, name, id) {
      files.push({ name: name, id: id }); return '';
    });
    return { text: rest.trim(), files: files };
  }
`;
