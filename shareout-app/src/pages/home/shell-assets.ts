/**
 * The workspace home's static script and stylesheet, served as cacheable files instead
 * of being inlined into every /home response (~1.2 MB of the document was these bytes).
 *
 * Same rail as the first-party SDK bundles: the page links `<path>?v=<hash>`; a request
 * naming this deploy's hash is immutable, anything else gets the short-TTL alias.
 * Under /sdk/ so workspace subdomains pass it through (a /home/* path there is an
 * artifact slug).
 */
import { WORKSPACE_CLIENT } from './render-workspace/client-script';
import { getStaticHomeI18nScript } from './home-i18n/runtime';
import { WORKSPACE_STYLES } from './render-workspace/styles';
import { homePageStyles } from '../../design-system/pages/home.css';

export const HOME_SHELL_JS = '/sdk/home-shell.js';
export const HOME_SHELL_CSS = '/sdk/home-shell.css';

const SHELL_ASSETS: Record<string, { body: string; type: string }> = {
  // i18n bootstrap first (it reads window.WSX_LOCALE set by the inline boot script),
  // then the shell; the inline page used to run them in this order.
  [HOME_SHELL_JS]: { body: `${getStaticHomeI18nScript()}\n${WORKSPACE_CLIENT}`, type: 'application/javascript; charset=utf-8' },
  // Page styles first, then the workspace shell: the order the page used to inline them.
  [HOME_SHELL_CSS]: { body: `${homePageStyles}\n${WORKSPACE_STYLES}`, type: 'text/css; charset=utf-8' },
};

const IMMUTABLE = 'public, max-age=31536000, immutable';
const ALIAS = 'public, max-age=300, must-revalidate';

let versions: Promise<Record<string, string>> | null = null;

async function digest(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Content hash per shell asset path, computed once per isolate. */
function shellVersions(): Promise<Record<string, string>> {
  versions ??= Promise.all(
    Object.entries(SHELL_ASSETS).map(async ([path, a]) => [path, await digest(a.body)] as const),
  ).then(Object.fromEntries);
  return versions;
}

/** `<path>?v=<hash>` for both shell assets. */
export async function homeShellUrls(): Promise<{ js: string; css: string }> {
  const v = await shellVersions();
  return { js: `${HOME_SHELL_JS}?v=${v[HOME_SHELL_JS]}`, css: `${HOME_SHELL_CSS}?v=${v[HOME_SHELL_CSS]}` };
}

/** GET handler for the shell assets; null for any other path. */
export async function serveHomeShellAsset(path: string, v: string | null): Promise<Response | null> {
  const asset = SHELL_ASSETS[path];
  if (!asset) return null;
  const pinned = !!v && (await shellVersions())[path] === v;
  return new Response(asset.body, {
    headers: {
      'Content-Type': asset.type,
      'Cache-Control': pinned ? IMMUTABLE : ALIAS,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
