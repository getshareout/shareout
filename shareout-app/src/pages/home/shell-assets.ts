/**
 * The workspace home's static script and stylesheet, served as cacheable files instead
 * of being inlined into every /home response (~1.2 MB of the document was these bytes).
 *
 * Same rail as the first-party SDK bundles: the page links `<path>?v=<hash>`; a request
 * naming this deploy's hash is immutable, anything else gets the short-TTL alias.
 * The lazy lens chunks (/sdk/home-lens-<name>.js) and the per-locale copy files
 * (/sdk/home-i18n-<locale>.js, one per page load) ride the same rail.
 * Under /sdk/ so workspace subdomains pass it through (a /home/* path there is an
 * artifact slug).
 */
import { WORKSPACE_CLIENT } from './render-workspace/client-script';
import { getStaticHomeI18nScript, homeLocaleCopyScript } from './home-i18n/runtime';
import { LOCALES, type Locale } from '../../i18n/locale';
import { WORKSPACE_STYLES } from './render-workspace/styles';
import { homePageStyles } from '../../design-system/pages/home.css';
import { LAZY_CHUNKS, lazyChunkBody, lazyChunkPath } from './render-workspace/client-script/lazy-chunks';

export const HOME_SHELL_JS = '/sdk/home-shell.js';
export const HOME_SHELL_CSS = '/sdk/home-shell.css';
export const homeI18nPath = (locale: Locale): string => `/sdk/home-i18n-${locale}.js`;

const JS = 'application/javascript; charset=utf-8';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const ALIAS = 'public, max-age=300, must-revalidate';

interface ShellAsset { body: string; type: string; v: string }

async function digest(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

let assets: Promise<Record<string, ShellAsset>> | null = null;

/** Every shell asset with its content hash, built once per isolate. The lazy lens chunks
 *  and locale copy files are hashed first so the shell can carry their pinned URLs
 *  (window.WSX_CHUNKS, window.WSX_I18N). */
function shellAssets(): Promise<Record<string, ShellAsset>> {
  assets ??= (async () => {
    const out: Record<string, ShellAsset> = {};
    const urls: Record<string, string> = {};
    for (const name of Object.keys(LAZY_CHUNKS)) {
      const body = lazyChunkBody(name);
      const v = await digest(body);
      out[lazyChunkPath(name)] = { body, type: JS, v };
      urls[name] = `${lazyChunkPath(name)}?v=${v}`;
    }
    const i18n: Record<string, string> = {};
    for (const locale of LOCALES) {
      const body = homeLocaleCopyScript(locale);
      const v = await digest(body);
      out[homeI18nPath(locale)] = { body, type: JS, v };
      i18n[locale] = `${homeI18nPath(locale)}?v=${v}`;
    }
    // i18n bootstrap first (it reads window.WSX_LOCALE set by the inline boot script and
    // the copy the page loaded just before), then the shell.
    const js = `window.WSX_I18N=${JSON.stringify(i18n)};\n${getStaticHomeI18nScript()}\nwindow.WSX_CHUNKS=${JSON.stringify(urls)};\n${WORKSPACE_CLIENT}`;
    out[HOME_SHELL_JS] = { body: js, type: JS, v: await digest(js) };
    // Page styles first, then the workspace shell: the order the page used to inline them.
    const css = `${homePageStyles}\n${WORKSPACE_STYLES}`;
    out[HOME_SHELL_CSS] = { body: css, type: 'text/css; charset=utf-8', v: await digest(css) };
    return out;
  })();
  return assets;
}

/** True for a path served by serveHomeShellAsset. */
export function isHomeShellAssetPath(path: string): boolean {
  return path === HOME_SHELL_JS || path === HOME_SHELL_CSS || /^\/sdk\/home-(lens|i18n)-[a-z]+\.js$/.test(path);
}

/** `<path>?v=<hash>` for both shell assets. */
export async function homeShellUrls(): Promise<{ js: string; css: string }> {
  const a = await shellAssets();
  return { js: `${HOME_SHELL_JS}?v=${a[HOME_SHELL_JS].v}`, css: `${HOME_SHELL_CSS}?v=${a[HOME_SHELL_CSS].v}` };
}

/** `<path>?v=<hash>` for one locale's copy file. */
export async function homeI18nUrl(locale: Locale): Promise<string> {
  const path = homeI18nPath(locale);
  return `${path}?v=${(await shellAssets())[path].v}`;
}

/** GET handler for the shell assets; null for any other path. */
export async function serveHomeShellAsset(path: string, v: string | null): Promise<Response | null> {
  const asset = (await shellAssets())[path];
  if (!asset) return null;
  const pinned = !!v && asset.v === v;
  return new Response(asset.body, {
    headers: {
      'Content-Type': asset.type,
      'Cache-Control': pinned ? IMMUTABLE : ALIAS,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
