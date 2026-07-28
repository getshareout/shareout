// Crawl-discovery + agent-discovery files.
// Served by routeServe only on the apex host (not workspace subdomains).
//
// Everything here describes a *public marketing site*: robots.txt invites every
// crawler, the sitemap lists product pages, llms.txt pitches the product. That is
// right for the hosted apex and wrong for a self-hosted instance, which is usually a
// private company workspace. Hardcoded, these files had a self-hoster publishing a
// sitemap of someone else's domain, inviting crawlers into a private workspace, and
// pinging IndexNow with someone else's verification key.
//
// So each function branches on isMarketingApex(env).

import type { Env } from '../types';
import { getPlatformHostname, getPlatformOrigin, isMarketingApex } from '../config/origins';

// Worker-served indexable pages. The marketing site (home, platform, solutions, …)
// lives on the Pages project and ships its own sitemap-0.xml, proxied at the apex.
const PRODUCT_PATHS = ['/create'];

// Bump when marketing content meaningfully changes — surfaced as <lastmod> so
// crawlers can prioritize. A real date beats a per-request now() (which looks fake).
const LAST_MODIFIED = '2026-07-26';

function notFound(): Response {
  return new Response('Not found\n', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function textResponse(body: string, maxAge = 3600): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': `public, max-age=${maxAge}`,
    },
  });
}

// Self-authored robots.txt. On the hosted apex the Cloudflare-managed robots.txt
// (which blocked AI crawlers) is disabled, so the Worker owns this: allow everyone,
// point to the sitemap. AI crawlers are intentionally welcome for GEO citation.
//
// A self-hosted instance gets the opposite default: ShareOut is private-first, and an
// instance full of internal dashboards should not become indexable just because it
// booted. Opening it to crawlers is a deliberate act — invert the Disallow below.
export function serveRobots(env: Env): Response {
  if (!isMarketingApex(env)) {
    return textResponse('User-agent: *\nDisallow: /\n');
  }
  // Marketing apex: invite crawlers to product pages. Public artifacts under /a/
  // may still be indexed (they are intentionally open); closed artifacts return
  // X-Robots-Tag: noindex on every gate and authorized response. Thumbnails and
  // delivery URLs are never useful for search — keep bots off those shapes.
  return textResponse(`User-agent: *
Allow: /
Disallow: /t/
Disallow: /embed/
Disallow: /d/

Sitemap: ${getPlatformOrigin(env)}/sitemap.xml
`);
}

// IndexNow: instantly notify Bing/Copilot (and Perplexity via Bing) when a public
// page changes. The key is verified by hosting it at /<key>.txt on the same host,
// so it is only meaningful for the host that owns it.
export const INDEXNOW_KEY = 'a7f3c9e21b8d4e6fa0c5d8b3e1f6a249';

export function serveIndexNowKey(): Response {
  return new Response(INDEXNOW_KEY, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

// Fire-and-forget IndexNow submission. Call inside executionCtx.waitUntil so it
// never blocks the response.
//
// No-op off the marketing apex: the key above belongs to the hosted host, so a
// self-hosted instance submitting under it would be claiming URLs on a domain it does
// not control — and would spend a request per publish to be rejected.
export async function pingIndexNow(urls: string[], env: Env): Promise<void> {
  if (!isMarketingApex(env)) return;
  const origin = getPlatformOrigin(env);
  const urlList = urls.filter((u) => u.startsWith(`${origin}/`));
  if (urlList.length === 0) return;
  try {
    await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: getPlatformHostname(env),
        key: INDEXNOW_KEY,
        keyLocation: `${origin}/${INDEXNOW_KEY}.txt`,
        urlList,
      }),
    });
  } catch {
    // Best-effort: a failed IndexNow ping must never affect publishing.
  }
}

// /sitemap.xml — a sitemap index spanning both surfaces: the marketing site's own
// sitemap (every marketing page, auto-updated on deploy) and the worker's product
// pages. robots.txt points crawlers here.
export function serveSitemap(env: Env): Response {
  if (!isMarketingApex(env)) return notFound();
  const origin = getPlatformOrigin(env);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${origin}/sitemap-0.xml</loc></sitemap>
  <sitemap><loc>${origin}/sitemap-product.xml</loc></sitemap>
</sitemapindex>`;
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

// /sitemap-product.xml — the worker-owned indexable pages, referenced by the
// sitemap index above.
export function serveProductSitemap(env: Env): Response {
  if (!isMarketingApex(env)) return notFound();
  const origin = getPlatformOrigin(env);
  const urls = PRODUCT_PATHS.map(
    (p) => `  <url><loc>${origin}${p}</loc><lastmod>${LAST_MODIFIED}</lastmod></url>`,
  ).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

// The marketing pitch — marketing apex only.
function marketingLlmsTxt(origin: string): string {
  return `# ShareOut

> From idea to live. ShareOut turns your data into live dashboards, decks and docs — describe what you want and it builds and publishes it to the web in seconds. The living replacement for slides, spreadsheets and static dashboards.

ShareOut is an open-source, AI-native publishing platform. Agents and people POST HTML, CSV, Markdown, JSON or TXT and get a live URL with backing data (tables, JSON store, blobs), auth and real-time collaboration — no build step, no hosting. Apache-2.0, self-hosted on your own Cloudflare account.

## Docs

- [Documentation](https://docs.shareout.site): full product docs — editor, SDK, REST API, integrations, crew automations and the artifact spec. Also available as [/llms-full.txt](https://docs.shareout.site/llms-full.txt).
- [Agent skill](${origin}/v1/skill): the full ShareOut API and SDK reference for building and publishing artifacts.
- [Integration discovery](${origin}/.well-known/integrations.json): machine-readable map of REST API surfaces, credentials, and OpenAPI spec for agents and integrations.sh.
- [OpenAPI spec](${origin}/openapi.json): REST API schema (publish, artifacts, data, jobs, workspaces).
- [Cookbook](https://github.com/getshareout/cookbook): task recipes — turn a Google Sheet into a live dashboard, share a report with no backend, build a dashboard from Snowflake/BigQuery, publish an internal tool or form, and how an AI agent publishes a live page.

## Open source

- [ShareOut](https://github.com/getshareout/shareout): the platform — Worker, SDK, visual editor and agent skill. Apache-2.0, no paid tiers.
- [SDK](https://github.com/getshareout/shareout-sdk): the browser SDK — data, real-time sync, files and live sources.
- [Examples](https://github.com/getshareout/shareout-examples): sample artifacts — dashboards, decks, tools and real-time apps.
- [Skill source](https://github.com/getshareout/shareout-skill): the agent skill, on GitHub.

## Product

- [Build with agents](${origin}/platform/agents): how AI agents ship live pages in one API call and run scheduled crews.
- [Live demo](${origin}/demo): an interactive ShareOut workspace you can click through in the browser.
- [Use cases](${origin}/use-cases): dashboards, live decks, internal tools and client-facing pages.

## Optional

- [Create](${origin}/create): describe what you want and watch ShareOut build it.
`;
}

// A self-hosted instance still benefits from agent discovery — an agent that lands
// here should find the skill and the API. What it must not do is pitch a product on a
// domain the operator does not own, or imply the workspace is public.
function instanceLlmsTxt(origin: string): string {
  return `# ShareOut instance

> A self-hosted ShareOut instance at ${origin}. ShareOut is an open-source workspace where agents and people publish live, data-backed pages. Content here is private unless its owner shared it.

## For agents

- [Agent skill](${origin}/v1/skill): the full ShareOut API and SDK reference for building and publishing artifacts on this instance.
- [OpenAPI spec](${origin}/openapi.json): REST API schema (publish, artifacts, data, jobs, workspaces).
- [Integration discovery](${origin}/.well-known/integrations.json): machine-readable map of REST API surfaces and credentials.

Publishing requires a token issued by this instance — ask its operator.

## About the project

- [Source](https://github.com/getshareout/shareout): Apache-2.0, self-hosted on Cloudflare Workers.
`;
}

export function serveLlmsTxt(env: Env): Response {
  const origin = getPlatformOrigin(env);
  return textResponse(isMarketingApex(env) ? marketingLlmsTxt(origin) : instanceLlmsTxt(origin));
}
