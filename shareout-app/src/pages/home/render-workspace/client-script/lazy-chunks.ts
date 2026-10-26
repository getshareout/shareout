/**
 * Rarely opened lenses, split out of the boot shell and fetched on first use.
 *
 * A chunk is plain shell-fragment source. The shell evaluates it with a direct eval
 * inside its IIFE, so the chunk sees every shell helper (esc, t, wsxModal, …) exactly
 * as when it was inlined. Its own declarations stay local to that eval; the shell
 * reaches them through stubs: `function loadAdmin() { … }` in the shell fetches the
 * chunk, then calls the chunk's real loadAdmin with the same arguments.
 *
 * `exports` are the chunk names the shell calls (load + call); `soft` are only called
 * when already loaded (a no-op otherwise); `vars` are read live via wsxChunkGet.
 */
import { workspace_client_home_views_admin_JS } from './home-views/admin';
import { workspace_client_home_views_adminSupport_JS } from './home-views/admin-support';
import { workspace_client_home_views_adminDomains_JS } from './home-views/admin-domains';
import { workspace_client_home_views_adminUsage_JS } from './home-views/admin-usage';
import { workspace_client_home_views_clients_JS } from './home-views/clients';
import { workspace_client_home_views_knowledge_JS } from './home-views/knowledge';
import { workspace_client_home_views_knowledgeMap_JS } from './home-views/knowledge-map';
import { workspace_client_home_views_catalog_JS } from './home-views/catalog';
import { workspace_client_home_views_catalogCert_JS } from './home-views/catalog-cert';
import { workspace_client_home_views_catalogMetrics_JS } from './home-views/catalog-metrics';
import { workspace_client_home_views_crew_JS } from './home-views/crew';
import { workspace_client_home_views_library_JS } from './home-views/library';
import { workspace_client_inspector_history_JS } from './inspector-history';
import { workspace_client_inspector_deliver_JS } from './inspector-deliver';
import { workspace_client_edit_lite_JS } from './edit-lite';
import { workspace_client_edit_lite_ai_JS } from './edit-lite-ai';
import { workspace_client_guest_comments_lazy_JS } from './guest-comments';
import { workspace_client_home_views_fileImport_JS } from './home-views/file-import';

interface ChunkDef { src: string; exports: string[]; soft?: string[]; vars?: string[] }

export const LAZY_CHUNKS: Record<string, ChunkDef> = {
  admin: {
    src: workspace_client_home_views_admin_JS + workspace_client_home_views_adminSupport_JS + workspace_client_home_views_adminDomains_JS + workspace_client_home_views_adminUsage_JS + workspace_client_home_views_clients_JS,
    exports: ['loadAdmin'],
  },
  knowledge: {
    src: workspace_client_home_views_knowledge_JS + workspace_client_home_views_knowledgeMap_JS,
    exports: ['loadKnowledge', 'knRoute'],
    soft: ['knStopPoll'],
    vars: ['knCurrentPath'],
  },
  catalog: {
    src: workspace_client_home_views_catalog_JS + workspace_client_home_views_catalogCert_JS + workspace_client_home_views_catalogMetrics_JS,
    exports: ['loadCatalog', 'catRoute'],
    vars: ['catCurrentId'],
  },
  crew: { src: workspace_client_home_views_crew_JS, exports: ['loadCrew'] },
  library: { src: workspace_client_home_views_library_JS, exports: ['loadLibrary'] },
  history: { src: workspace_client_inspector_history_JS, exports: ['renderHistory', 'openVersionDiff'] },
  deliver: { src: workspace_client_inspector_deliver_JS, exports: ['renderDeliver', 'renderWatches'] },
  edit: {
    src: workspace_client_edit_lite_JS + workspace_client_edit_lite_ai_JS,
    exports: ['loadEditSource', 'renderLive', 'renderEditPanel', 'autosaveDraft', 'publishEdit'],
    soft: ['editKeydown'],
  },
  guest: { src: workspace_client_guest_comments_lazy_JS, exports: ['wireGuestFolder', 'wireGuestArt'] },
  drives: { src: workspace_client_home_views_fileImport_JS, exports: ['openFileImport'] },
};

export const lazyChunkPath = (name: string): string => `/sdk/home-lens-${name}.js`;

/** The served chunk: its source, then the export object as the eval's completion value. */
export function lazyChunkBody(name: string): string {
  const c = LAZY_CHUNKS[name];
  const fns = [...c.exports, ...(c.soft ?? [])].map((n) => `${n}: ${n}`);
  const vars = (c.vars ?? []).map((n) => `get ${n}() { return ${n}; }`);
  return `${c.src}\n;({ ${[...fns, ...vars].join(', ')} });\n//# sourceURL=${lazyChunkPath(name)}\n`;
}

const stubs = Object.entries(LAZY_CHUNKS).flatMap(([name, c]) => [
  ...c.exports.map((fn) => `  function ${fn}() { return wsxLazy('${name}', '${fn}', arguments); }\n`),
  ...(c.soft ?? []).map((fn) => `  function ${fn}() { return wsxIfLoaded('${name}', '${fn}', arguments); }\n`),
]).join('');

/** Loader + stubs; part of the boot shell. window.WSX_CHUNKS maps names to hashed URLs. */
export const workspace_client_lazy_chunks_JS = `  // ===== lazy lens chunks (lazy-chunks.ts) =====
  var wsxChunkState = {};
  function wsxEvalChunk(wsxChunkSource) { return eval(wsxChunkSource); }
  function wsxChunk(name) {
    var st = wsxChunkState[name];
    if (st) return st.p;
    st = wsxChunkState[name] = {};
    var url = (window.WSX_CHUNKS && window.WSX_CHUNKS[name]) || ('/sdk/home-lens-' + name + '.js');
    st.p = fetch(url, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('chunk ' + name + ': HTTP ' + r.status); return r.text(); })
      .then(function (src) { st.ex = wsxEvalChunk(src); return st.ex; });
    st.p.catch(function (e) {
      delete wsxChunkState[name];
      if (typeof loaded === 'object' && loaded) delete loaded[name];
      console.warn('[wsx] could not load the ' + name + ' view', e);
    });
    return st.p;
  }
  function wsxLazy(name, fn, args) {
    var st = wsxChunkState[name];
    if (st && st.ex) return st.ex[fn].apply(null, args);
    wsxChunk(name).then(function (ex) { ex[fn].apply(null, args); }, function () {});
  }
  function wsxIfLoaded(name, fn, args) { var st = wsxChunkState[name]; if (st && st.ex) return st.ex[fn].apply(null, args); }
  function wsxChunkGet(name, key) { var st = wsxChunkState[name]; return st && st.ex ? st.ex[key] : undefined; }
${stubs}`;
