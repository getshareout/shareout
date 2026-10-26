/**
 * Inline-script twin of shared/data-sources/format.ts — the same wording rules for pages
 * that run plain scripts (the viewer panel, the Studio inspector tab). Defines
 * `soDsFormat(C, lang)`; tests/unit/provenance/format-parity.test.ts keeps it in step.
 */
export const DATA_SOURCES_FORMAT_JS = `
  function soDsFormat(C, lang) {
    var DOT = ' \\u00b7 ';
    function fill(s, map) { for (var k in map) s = s.split('{' + k + '}').join(String(map[k])); return s; }
    function date(v) {
      var t = Date.parse(v);
      if (isNaN(t)) return v;
      var o = { day: 'numeric', month: 'short', year: 'numeric' };
      if (/^\\d{4}-\\d{2}-\\d{2}$/.test(v)) o.timeZone = 'UTC';
      try { return new Intl.DateTimeFormat(lang, o).format(new Date(t)); } catch (e) { return v; }
    }
    function ago(iso) {
      var t = Date.parse(iso);
      if (isNaN(t)) return '';
      var s = Math.max(0, Math.floor((Date.now() - t) / 1000));
      if (s < 60) return C.justNow;
      if (s < 3600) return fill(C.minAgo, { n: Math.floor(s / 60) });
      if (s < 86400) return fill(C.hAgo, { n: Math.floor(s / 3600) });
      var d = Math.floor(s / 86400);
      if (d === 1) return C.yesterday;
      if (d < 30) return fill(C.daysAgo, { n: d });
      return fill(C.onDate, { date: date(iso) });
    }
    function label(s) {
      if (s.key === 'knowledge:workspace') return C.kindKnowledge;
      if (s.key === 'file:uploads') return C.kindUploads;
      if (s.key.indexOf(':~') > 0) {
        if (s.provider_label) return s.provider_label;
        return { json: C.kindSaved, table: C.kindTable, dataset: C.kindDataset, file: C.kindFile, external: C.kindExternal, connection: C.kindConnection }[s.kind] || s.label;
      }
      return s.label;
    }
    function freshness(s) {
      var f = s.freshness || {}, r = f.refresher;
      if (r && r.type === 'live') return s.kind === 'mcp' ? C.liveAsYou : C.live;
      if (f.last_refresh_at) {
        var by = r ? (r.name ? fill(r.type === 'crew' ? C.byCrew : C.byJob, { name: r.name }) : (r.type === 'job' || r.type === 'crew' ? C.bySchedule : '')) : '';
        return fill(C.updated, { when: ago(f.last_refresh_at) }) + (by ? DOT + by : '');
      }
      if (r && (r.type === 'job' || r.type === 'crew')) return r.name ? fill(r.type === 'crew' ? C.keptByCrew : C.keptByJob, { name: r.name }) : C.keptBySchedule;
      if (f.as_of) return fill(C.asOf, { date: date(f.as_of) });
      if (f.refresh) return fill(C.refreshes, { text: f.refresh });
      if (r && r.type === 'manual') return C.manual;
      return C.notDeclared;
    }
    function origin(s, byKey) {
      if (s.kind === 'connection' || s.kind === 'external') return s.provider_label && s.provider_label !== label(s) ? s.provider_label : '';
      if (s.kind === 'mcp') return '';
      var names = [];
      (s.upstream || []).forEach(function (k) { var u = byKey[k]; if (u) names.push(u.provider_label || label(u)); });
      return names.length ? fill(C.from, { name: names.join(', ') }) : '';
    }
    function feeds(s) {
      var n = s.feed_count || 0;
      return n === 0 ? C.feedsNone : n === 1 ? C.feedsOne : fill(C.feedsMany, { n: n });
    }
    function details(d) {
      if (!d) return null;
      var rows = [];
      function row(term, value) { if (value) rows.push([term, value]); }
      if (d.connection) {
        row(C.connection, [d.connection.name, d.connection.scope === 'workspace' ? C.scopeWorkspace : C.scopeArtifact,
          d.connection.credential_scope === 'per_user' ? C.credsPerUser : C.credsShared].join(DOT));
      } else if (d.missing_connection) {
        row(C.connection, fill(C.missingConnection, { name: d.missing_connection }));
      }
      if (d.tables && d.tables.length) row(C.tables, d.tables.join(', '));
      (d.refreshers || []).forEach(function (r) {
        var parts = [fill(r.type === 'crew' ? C.refCrew : r.type === 'sync' ? C.refSync : C.refJob, { name: r.name })];
        if (r.schedule) parts.push(r.schedule);
        if (!r.enabled) parts.push(C.paused);
        else if (r.last_status === 'failed') parts.push(C.lastFailed);
        row(C.updatedBy, parts.join(DOT));
      });
      if (d.tools && d.tools.length) row(C.tools, d.tools.join(', '));
      if (d.hosts && d.hosts.length) row(C.hosts, d.hosts.join(', '));
      var rep = d.replication || {};
      row(C.credentials, rep.credentials);
      row(C.rebuild, rep.build);
      row(C.publishCmd, rep.publish);
      row(C.notes, rep.notes);
      var m = d.manage || {}, links = [];
      [[m.connections, C.manageConnections], [m.jobs, C.manageJobs], [m.data, C.manageData]].forEach(function (p) { if (p[0]) links.push(p); });
      if (!d.query && !rows.length && !links.length) return null;
      var out = { rows: rows, links: links };
      if (d.query) out.query = d.query;
      return out;
    }
    return {
      label: label, origin: origin, freshness: freshness, feeds: feeds, details: details,
      meta: function (s, byKey) { return [origin(s, byKey), freshness(s)].filter(Boolean).join(DOT); }
    };
  }
`;
