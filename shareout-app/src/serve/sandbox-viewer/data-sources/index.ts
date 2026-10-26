/**
 * The viewer's "Data" pill and Data sources panel, for every viewer of a page that shows
 * data (signed in, guest or public link). Self-contained: its own tokens-only styles,
 * markup and script, so it works with or without the floating toolbar — with a toolbar
 * the pill moves next to its trigger; without one it keeps the same corner.
 */
import type { Locale } from '../../../i18n';
import { cssVariables } from '../../../design-system/base.css';
import { DATA_SOURCES_COPY } from './copy';
import { dataSourcesStyles } from './styles';
import { dataSourcesIcon, renderDataSourcesScript } from './script';

export interface DataSourcesPanelOptions {
  artifactId: string;
  /** The HTML page being shown (`?page=` on multi-page sites). */
  page: string;
  locale: Locale;
  /** The page declares live connections (MCP): show the pill without waiting for the frame. */
  visible: boolean;
  /** Ship the --color-* / --space-* tokens (the toolbar already ships them when present). */
  withVars: boolean;
}

export function renderDataSourcesPanel(opts: DataSourcesPanelOptions): string {
  const c = DATA_SOURCES_COPY[opts.locale] ?? DATA_SOURCES_COPY.en;
  const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `
  <style>${opts.withVars ? cssVariables : ''}${dataSourcesStyles}</style>
  <div id="so-ds-dock">
    <button type="button" id="so-ds-pill" class="so-ds-pill" hidden aria-haspopup="dialog" aria-expanded="false" aria-controls="so-ds-panel" title="${attr(c.pillTitle)}">
      ${dataSourcesIcon('data')}<span>${attr(c.pill)}</span>
    </button>
  </div>
  <section id="so-ds-panel" role="dialog" aria-modal="false" aria-labelledby="so-ds-title" hidden>
    <div class="so-ds-head">
      <h2 id="so-ds-title" class="so-ds-title" tabindex="-1">${attr(c.title)}</h2>
      <button type="button" class="so-ds-close" aria-label="${attr(c.close)}">${dataSourcesIcon('close', 18)}</button>
    </div>
    <p class="so-ds-lead">${attr(c.lead)}</p>
    <div id="so-ds-body" class="so-ds-body"></div>
    <p id="so-ds-status" class="so-ds-sr" aria-live="polite"></p>
    <p id="so-ds-foot" class="so-ds-foot" hidden>${attr(c.editorsOnly)}</p>
  </section>
  <script>${renderDataSourcesScript({ artifactId: opts.artifactId, page: opts.page, lang: opts.locale, copy: c, visible: opts.visible })}</script>`;
}
