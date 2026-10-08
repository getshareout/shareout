/**
 * Pure text helpers for the agent dock: safe Markdown (also for partial, still-streaming
 * text) and the attachment marker the agent needs in the message text but the reader
 * should see as a file chip. No DOM access — unit-tested by evaluating this fragment.
 */
export const workspace_client_agent_format_JS = `  // ===== agent dock: text helpers (pure) =====
  function mdEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  // ----- safe Markdown: fenced code -> headings/lists/quote/hr -> paragraphs, inline last -----
  function mdInline(t) {
    var BT = String.fromCharCode(96);
    var s = mdEsc(t);
    s = s.replace(new RegExp(BT + '([^' + BT + ']+)' + BT, 'g'), '<code>$1</code>');
    s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\\*([^*\\n]+)\\*/g, '$1<em>$2</em>');
    s = s.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/(^|\\s)(https?:\\/\\/[^\\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    return s;
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
