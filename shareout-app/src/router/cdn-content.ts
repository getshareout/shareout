import type { Env } from '../types';
import { handleServe } from '../serve';
import { getCdnRegistrable, getPlatformOrigin } from '../config/origins';
import { CDN_REGISTRABLE } from '../serve/security';
import { serveSharedBundle } from './shared-bundles';
import { contentRouteKey, resolveRoutedDeployment } from '../serve/deployment-cache';

// Subdomains that must never resolve to an artifact even though they are valid
// labels. (Hex-only validation already excludes these, but keep the guard explicit.)
const RESERVED_LABELS = new Set([
  'www', 'api', 'app', 'admin', 'cdn', 'static', 'mail', 'assets', 'docs',
]);

// The content host is `<hex>.shareoutcdn.site` where <hex> is the immutable artifact
// id minus its `art_` prefix. Accept only single-level hex labels (ADR 30); reject
// reserved words, multi-level hosts, and anything non-hex.
export function parseCdnLabel(hostname: string, cdnRegistrable: string = CDN_REGISTRABLE): string | null {
  const suffix = `.${cdnRegistrable}`;
  if (!hostname.endsWith(suffix)) return null;
  const label = hostname.slice(0, -suffix.length);
  if (!label || label.includes('.')) return null;
  if (RESERVED_LABELS.has(label)) return null;
  if (!/^[0-9a-f]{16,64}$/.test(label)) return null;
  return label;
}

const notFound = () => new Response('Not Found', { status: 404 });

/**
 * Dispatch for the dedicated untrusted-content domain (`*.shareoutcdn.site`).
 *
 * Serves ONLY raw artifact bytes for the one artifact identified by the subdomain —
 * never auth, app, admin, the data API, or a session cookie. Private artifacts are
 * authorized by the path-prefix capability token (`/c/<ct>/…`); the trusted shell on
 * shareout.site mints it after its own access check (ADR 30).
 */
export async function handleCdnContent(request: Request, env: Env, executionCtx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const hostname = url.hostname;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Shared public bundles (SDK / CSS / editor) resolve on the content host too: a
  // pre-cutover artifact loads the SDK by same-origin path (/sdk/shareout.js), which
  // now lands on <hex>.shareoutcdn.site. Serve them before artifact resolution so the
  // path doesn't fall through to a 404 (which surfaces as "ShareOut is not defined").
  const bundle = serveSharedBundle(request, env, url.pathname, executionCtx);
  if (bundle) return bundle;

  const cdn = getCdnRegistrable(env) || CDN_REGISTRABLE;
  const label = parseCdnLabel(hostname, cdn);
  if (!label) {
    // Bare apex sends humans to the app; anything else here is not a thing we serve.
    if (hostname === cdn && (url.pathname === '/' || url.pathname === '')) {
      return Response.redirect(`${getPlatformOrigin(env)}/`, 301);
    }
    return notFound();
  }

  const artifactId = `art_${label}`;
  const deployment = await resolveRoutedDeployment(
    env, contentRouteKey(artifactId), 'd.artifact_id = ?', [artifactId], executionCtx,
  );
  if (!deployment) return notFound();

  // Optional private capability prefix: /c/<ct>/<assetPath>. The token rides in the
  // path so the artifact's relative subresource requests inherit it without cookies.
  let path = url.pathname.replace(/^\//, '');
  let ct: string | null = null;
  const m = path.match(/^c\/([^/]+)\/?(.*)$/);
  if (m) {
    ct = decodeURIComponent(m[1]);
    path = m[2];
  }

  // Force raw serving so handleServe never returns the sandbox shell here (that would
  // frame the artifact inside itself on its own origin).
  const rawUrl = new URL(url.toString());
  rawUrl.searchParams.set('_raw', '');
  const rawReq = new Request(rawUrl.toString(), request);

  const resp = await handleServe(rawReq, env, deployment.slug, path, {
    contentOrigin: true, ct, executionCtx, cached: deployment.record,
  });

  // No cookies belong on the content domain — strip any the serve path may set (the
  // session cookie must never ride onto this origin).
  if (resp.headers.has('Set-Cookie')) {
    const stripped = new Response(resp.body, resp);
    stripped.headers.delete('Set-Cookie');
    return stripped;
  }
  return resp;
}
