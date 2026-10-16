/**
 * Client state behind the search palette, exposed as `wsxSearchStore` in the shell IIFE.
 *
 * - The search index (GET /v1/home/search-index): kept in memory and in IndexedDB, keyed
 *   by user and workspace, so the next page load ranks from disk before any network.
 *   Revalidated in the background with If-None-Match (an unchanged index is a 304).
 * - Recent searches and recently opened pages: localStorage per user and workspace,
 *   mirrored to /v1/home/recent-searches so they follow the user to other devices.
 * Every storage call is wrapped: private windows and blocked storage just mean no cache.
 * Depends on wsxSearch (search-engine.ts) and t().
 */
export const workspace_client_search_store_JS = `
  // ===== search index + recent searches (search-store.ts) =====
  var wsxSearchStore = (function () {
    var WS = window.WSX_WS || '';
    var UK = window.WSX_UK || '';
    var SCOPE = UK + '|' + WS;
    var WSQ = WS ? 'workspace=' + encodeURIComponent(WS) : '';
    var STALE_MS = 60000, SHOW_RECENT = 8, KEEP_RECENT = 20, KEEP_OPENED = 8;
    var idx = null, etag = '', checkedAt = 0, loading = null, diskTried = false, listeners = [];

    // ---- IndexedDB (one object store, key = user|workspace) ----
    var dbP = null;
    function db() {
      if (dbP) return dbP;
      dbP = new Promise(function (res, rej) {
        try {
          if (typeof indexedDB === 'undefined' || !indexedDB) { rej(0); return; }
          var r = indexedDB.open('wsx-search', 1);
          r.onupgradeneeded = function () { try { r.result.createObjectStore('idx'); } catch (e) {} };
          r.onsuccess = function () { res(r.result); };
          r.onerror = function () { rej(r.error); };
          r.onblocked = function () { rej(0); };
        } catch (e) { rej(e); }
      });
      dbP.catch(function () {});
      return dbP;
    }
    function diskGet() {
      return db().then(function (d) {
        return new Promise(function (res) {
          try { var q = d.transaction('idx', 'readonly').objectStore('idx').get(SCOPE); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; }
          catch (e) { res(null); }
        });
      }, function () { return null; });
    }
    function diskPut(rec) { db().then(function (d) { try { d.transaction('idx', 'readwrite').objectStore('idx').put(rec, SCOPE); } catch (e) {} }, function () {}); }

    // ---- prepare positional rows into rankable items (fields folded once) ----
    function pageCount(n) { return (t(n === 1 ? 'search.pageCount.one' : 'search.pageCount.other') || '{n}').replace('{n}', n); }
    function prepare(d) {
      var F = wsxSearch.fold, owners = d.owners || [], wss = d.workspaces || [], fname = {};
      (d.folders || []).forEach(function (f) { fname[f[0]] = f[1]; });
      var byId = {};
      var arts = (d.artifacts || []).map(function (a) {
        var o = a[9] >= 0 ? owners[a[9]] : null, w = a[10] >= 0 ? wss[a[10]] : null, folder = fname[a[4]] || '';
        var it = {
          kind: 'artifact', id: a[0], slug: a[1], title: a[2], artifactType: a[3] || 'html',
          subtitle: [w ? w[1] : '', folder, a[7]].filter(Boolean).join(' \\u00b7 ') || undefined,
          thumb: (a[8] & 2) ? '/t/' + a[0] + '_card.webp?v=' + a[6] : undefined,
          owner: o ? o[0] : undefined, avatar: o && o[1] ? o[1] : undefined,
          badge: (a[8] & 1) ? 'Private' : undefined,
          _n: F(a[2]), _t: F(String(a[5] || '').replace(/\\n/g, ' ') + ' ' + a[1]), _d: F(a[7] + ' ' + folder + (w ? ' ' + w[1] : '')), _u: a[6]
        };
        byId[a[0]] = it;
        return it;
      });
      var folders = (d.folders || []).map(function (f) {
        return { kind: 'folder', id: f[0], title: f[1], subtitle: pageCount(f[3] || 0), _n: F(f[1]), _t: '', _d: F(fname[f[2]] || '') };
      });
      var people = (d.people || []).map(function (p) {
        var role = p[4] ? p[4].charAt(0).toUpperCase() + p[4].slice(1) : '';
        return { kind: 'person', id: p[0], title: p[1] || p[2] || 'Member', subtitle: [role, p[2] && p[2] !== p[1] ? p[2] : ''].filter(Boolean).join(' \\u00b7 '), avatar: p[3] || undefined, _n: F(p[1] || p[2]), _t: F(p[2]), _d: '' };
      });
      return { artifacts: arts, folders: folders, people: people, byId: byId, recent: d.recent || [], truncated: !!d.truncated };
    }
    function use(d, tag) {
      if (!d || d.v !== 1) return false;
      idx = prepare(d); etag = tag || '';
      listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
      return true;
    }
    function revalidate() {
      var h = etag ? { 'If-None-Match': etag } : {};
      return fetch('/v1/home/search-index' + (WSQ ? '?' + WSQ : ''), { credentials: 'same-origin', headers: h })
        .then(function (r) {
          checkedAt = Date.now();
          if (r.status === 304 || !r.ok) return;
          var tag = (r.headers && r.headers.get('ETag')) || '';
          return r.json().then(function (d) { if (use(d, tag)) diskPut({ etag: tag, data: d, at: Date.now() }); });
        })
        .catch(function () {});
    }
    // Disk first (instant on a repeat visit); the network only when asked or when nothing is cached.
    function warm(network) {
      if (loading) return loading;
      var fromDisk = idx || diskTried ? Promise.resolve() : diskGet().then(function (rec) { diskTried = true; if (rec && rec.data && !idx) use(rec.data, rec.etag); });
      loading = fromDisk.then(function () {
        if (network ? Date.now() - checkedAt > STALE_MS : !idx && !checkedAt) return revalidate();
      }).then(done, done);
      function done() { loading = null; }
      return loading;
    }

    // ---- recent searches + recently opened (localStorage, per user + workspace) ----
    var LS = 'wsx_search:' + SCOPE;
    function readLs() { try { var v = JSON.parse(localStorage.getItem(LS) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
    function writeLs(v) { try { localStorage.setItem(LS, JSON.stringify(v)); } catch (e) {} }
    function cleanQ(q) { return String(q || '').replace(/\\s+/g, ' ').trim().slice(0, 200); }
    function setSearches(list) { var v = readLs(); v.rs = (list || []).slice(0, KEEP_RECENT); writeLs(v); }
    function searches() { var rs = readLs().rs; return Array.isArray(rs) ? rs.filter(function (r) { return r && typeof r.q === 'string'; }).slice(0, SHOW_RECENT) : []; }
    function api(method, extra, body) {
      var qs = [WSQ, extra].filter(Boolean).join('&');
      var init = { method: method, credentials: 'same-origin' };
      if (body) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
      return fetch('/v1/home/recent-searches' + (qs ? '?' + qs : ''), init)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d && Array.isArray(d.searches)) { setSearches(d.searches); return true; } return false; })
        .catch(function () { return false; });
    }
    var syncedAt = 0;
    function syncSearches() { if (Date.now() - syncedAt < 30000) return Promise.resolve(false); syncedAt = Date.now(); return api('GET'); }
    function remember(q) {
      q = cleanQ(q); if (!q) return;
      var k = wsxSearch.fold(q), rs = (readLs().rs || []).filter(function (r) { return r && wsxSearch.fold(r.q) !== k; });
      rs.unshift({ q: q, at: new Date().toISOString() });
      setSearches(rs);
      api('POST', '', { q: q });
    }
    function forget(q) {
      var k = wsxSearch.fold(q);
      setSearches((readLs().rs || []).filter(function (r) { return r && wsxSearch.fold(r.q) !== k; }));
      return api('DELETE', 'q=' + encodeURIComponent(q));
    }
    function clearSearches() { setSearches([]); return api('DELETE'); }
    function noteOpened(id) {
      if (!id) return;
      var v = readLs(), ro = (Array.isArray(v.ro) ? v.ro : []).filter(function (x) { return x !== id; });
      ro.unshift(id); v.ro = ro.slice(0, KEEP_OPENED); writeLs(v);
    }
    function opened(limit) {
      if (!idx) return [];
      var seen = {}, out = [], local = readLs().ro;
      (Array.isArray(local) ? local : []).concat(idx.recent).forEach(function (id) {
        if (seen[id] || out.length >= limit) return; seen[id] = 1;
        if (idx.byId[id]) out.push(idx.byId[id]);
      });
      return out;
    }

    return {
      index: function () { return idx; },
      warm: warm,
      onChange: function (fn) { listeners.push(fn); },
      searches: searches, syncSearches: syncSearches, remember: remember, forget: forget, clearSearches: clearSearches,
      noteOpened: noteOpened, opened: opened
    };
  })();
`;
