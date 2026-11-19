// The marketing site's "What's new" link (/resources/changelog) and the short address
// /whats-new open the docs site's What's new, which is rebuilt from CHANGELOG.md with every
// release — so a visitor never lands on a stale hand-written list. Only where a marketing
// site is configured (MARKETING_ORIGIN); self-hosted instances keep their own 404.
// Language comes from Accept-Language: the marketing site keeps the visitor's pick in
// localStorage, which the worker cannot read.
const DOCS = 'https://docs.shareout.site';
const PATHS = new Set(['/whats-new', '/whats-new/', '/resources/changelog', '/resources/changelog/']);

export function whatsNewRedirect(path: string, acceptLanguage: string | null): Response | null {
  if (!PATHS.has(path)) return null;
  const first = (acceptLanguage ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  const es = first === 'es' || first.startsWith('es-');
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${DOCS}${es ? '/es' : ''}/whats-new/`,
      Vary: 'Accept-Language',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
