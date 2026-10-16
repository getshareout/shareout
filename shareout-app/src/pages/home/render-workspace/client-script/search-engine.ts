/**
 * Local ranking for the search palette: pure functions over the prepared search index
 * (search-index.ts on the server), run on every keystroke with no network.
 *
 * Tiers, never crossed by the recency boost (max 0.05):
 *   exact 1 > prefix 0.9 > word-start 0.78–0.84 > substring 0.6 > every word 0.55
 *   > in-order subsequence 0.25–0.45 (typo / gap tolerant).
 * Text is folded once on load (lowercase, accents stripped), so "clasificacion" finds
 * "Clasificación". Items carry `_n` (name), `_t` (tags, slug, email) and `_d`
 * (description, folder) already folded, and `_u` (updated, unix seconds).
 * Exposed as `wsxSearch` inside the shell IIFE; tests eval it on its own.
 */
export const workspace_client_search_engine_JS = `
  // ===== local search ranking (search-engine.ts) =====
  var wsxSearch = (function () {
    var MARKS = /[\\u0300-\\u036f]/g;
    function fold(s) { return s ? String(s).toLowerCase().normalize('NFD').replace(MARKS, '').replace(/\\s+/g, ' ').trim() : ''; }
    function alnum(c) { return (c >= 48 && c <= 57) || (c >= 97 && c <= 122) || c > 127; }
    function subseq(q, t) {
      var ti = 0, first = -1, last = -1, n = 0;
      for (var i = 0; i < q.length; i++) {
        var c = q.charCodeAt(i); if (c === 32) continue;
        var f = t.indexOf(q[i], ti); if (f < 0) return 0;
        if (first < 0) first = f; last = f; ti = f + 1; n++;
      }
      var span = last - first + 1;
      return span > 0 ? Math.min(1, n / span) : 0;
    }
    function tier(q, toks, t, fuzzy) {
      if (!t) return 0;
      if (t === q) return 1;
      if (t.lastIndexOf(q, 0) === 0) return 0.9;
      var i = t.indexOf(q);
      if (i > 0) {
        var j = i;
        while (j > 0 && alnum(t.charCodeAt(j - 1))) { j = t.indexOf(q, j + 1); if (j < 0) break; }
        if (j > 0) return 0.78 + 0.06 * (1 - j / t.length);
        return 0.6;
      }
      if (toks.length > 1) {
        var all = true;
        for (var k = 0; k < toks.length; k++) if (t.indexOf(toks[k]) < 0) { all = false; break; }
        if (all) return 0.55;
      }
      if (!fuzzy) return 0;
      var s = subseq(q, t);
      return s > 0 ? 0.25 + 0.2 * s : 0;
    }
    function boost(u, now) {
      if (!u) return 0;
      var days = (now - u) / 86400;
      return days >= 0 && days <= 90 ? 0.05 * (1 - days / 90) : 0;
    }
    function score(q, toks, it, now) {
      var s = tier(q, toks, it._n, true);
      if (s < 0.9 && it._t) s = Math.max(s, 0.7 * tier(q, toks, it._t, true));
      if (s < 0.6 && it._d) s = Math.max(s, 0.45 * tier(q, toks, it._d, false));
      return s > 0 ? s + boost(it._u, now) : 0;
    }
    // Top \`limit\` by score without sorting the whole list.
    function rank(items, query, limit) {
      var q = fold(query);
      if (!q || !items || !items.length) return [];
      var toks = q.split(' ').filter(Boolean), now = Date.now() / 1000, top = [];
      for (var i = 0; i < items.length; i++) {
        var s = score(q, toks, items[i], now);
        if (s <= 0 || (top.length >= limit && s <= top[top.length - 1].s)) continue;
        var at = top.length;
        while (at > 0 && top[at - 1].s < s) at--;
        top.splice(at, 0, { s: s, it: items[i] });
        if (top.length > limit) top.pop();
      }
      return top.map(function (x) { return x.it; });
    }
    return { fold: fold, rank: rank, score: function (query, it) { var q = fold(query); return score(q, q.split(' ').filter(Boolean), it, Date.now() / 1000); } };
  })();
`;
