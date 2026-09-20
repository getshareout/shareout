/**
 * Swap third-party CDN library URLs for this instance's vendored copies at publish
 * time, so an artifact written against cdn.plot.ly still loads Plotly from us.
 */
import type { Env, FileEntry } from '../types';
import { rewriteVendorUrls, vendorLibsEnabled } from '../vendor-cdn';

function rewritable(file: FileEntry): boolean {
  return file.encoding !== 'base64' && (file.mime === 'text/html' || file.path.endsWith('.html'));
}

export function vendorizePublishFiles(
  env: Env,
  files: FileEntry[],
  mobileHtml?: string,
): { files: FileEntry[]; mobileHtml?: string } {
  if (!vendorLibsEnabled(env)) return { files, mobileHtml };
  const baseUrl = env.SHAREOUT_BASE_URL;
  if (!baseUrl) return { files, mobileHtml };

  return {
    files: files.map(f => (rewritable(f) ? { ...f, content: rewriteVendorUrls(f.content, baseUrl) } : f)),
    mobileHtml: mobileHtml ? rewriteVendorUrls(mobileHtml, baseUrl) : mobileHtml,
  };
}
