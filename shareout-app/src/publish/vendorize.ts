/**
 * Swap third-party CDN library URLs for this instance's vendored copies at publish
 * time, so an artifact written against cdn.plot.ly still loads Plotly from us.
 *
 * Which packages count is resolved per workspace (built-in + instance env + the
 * workspace's own `vendor_packages` rows), so a team that registered its library gets
 * its URLs rewritten too.
 */
import type { Env, FileEntry } from '../types';
import { rewriteVendorUrls, vendorLibsEnabled, vendorAllowsAny, isValidPackageName, resolveAllowedPackages } from '../vendor-cdn';

function rewritable(file: FileEntry): boolean {
  return file.encoding !== 'base64' && (file.mime === 'text/html' || file.path.endsWith('.html'));
}

export async function vendorizePublishFiles(
  env: Env,
  files: FileEntry[],
  mobileHtml?: string,
  workspaceId?: string | null,
): Promise<{ files: FileEntry[]; mobileHtml?: string }> {
  if (!vendorLibsEnabled(env)) return { files, mobileHtml };
  const baseUrl = env.SHAREOUT_BASE_URL;
  if (!baseUrl) return { files, mobileHtml };

  const allowed = await resolveAllowedPackages(env, workspaceId ?? null);
  const isAllowed = vendorAllowsAny(env)
    ? isValidPackageName
    : (pkg: string) => allowed.has(pkg);

  return {
    files: files.map(f => (rewritable(f) ? { ...f, content: rewriteVendorUrls(f.content, baseUrl, isAllowed) } : f)),
    mobileHtml: mobileHtml ? rewriteVendorUrls(mobileHtml, baseUrl, isAllowed) : mobileHtml,
  };
}
