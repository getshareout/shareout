import { escapeHtml } from './utils';

export interface ExtractedSocialMeta {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
}

export interface ArtifactSocialFields {
  artifact_id: string;
  artifact_name: string;
  description?: string | null;
  social_title?: string | null;
  social_description?: string | null;
  social_image_url?: string | null;
  thumbnail_ext?: string | null;
}

export interface SocialPreview {
  title: string;
  description: string;
  imageUrl: string;
  canonicalUrl: string;
}

function extractMetaContent(html: string, attr: 'property' | 'name', key: string): string | null {
  const escapedKey = escapeRegex(key);
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${escapedKey}["'][^>]+content="([^"]*)"`, 'i'),
    new RegExp(`<meta[^>]+${attr}=["']${escapedKey}["'][^>]+content='([^']*)'`, 'i'),
    new RegExp(`<meta[^>]+content="([^"]*)"[^>]+${attr}=["']${escapedKey}["']`, 'i'),
    new RegExp(`<meta[^>]+content='([^']*)'[^>]+${attr}=["']${escapedKey}["']`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return decodeHtmlEntities(value);
  }

  return null;
}

function extractDocumentTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const value = match?.[1]?.trim();
  return value ? decodeHtmlEntities(value) : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

/** Parse Open Graph / Twitter / HTML meta from an artifact entrypoint. */
export function extractSocialMetaFromHtml(html: string): ExtractedSocialMeta {
  const title =
    extractMetaContent(html, 'property', 'og:title') ||
    extractMetaContent(html, 'name', 'twitter:title') ||
    extractDocumentTitle(html);

  const description =
    extractMetaContent(html, 'property', 'og:description') ||
    extractMetaContent(html, 'name', 'twitter:description') ||
    extractMetaContent(html, 'name', 'description');

  const imageUrl =
    extractMetaContent(html, 'property', 'og:image') ||
    extractMetaContent(html, 'name', 'twitter:image') ||
    extractMetaContent(html, 'name', 'twitter:image:src');

  return { title, description, imageUrl };
}

export function resolveArtifactSocialPreview(
  fields: ArtifactSocialFields,
  baseUrl: string,
  slug: string,
): SocialPreview {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const title = (fields.social_title || fields.artifact_name || slug).trim();
  const description = (fields.social_description || fields.description || '').trim();

  let imageUrl = fields.social_image_url?.trim() || '';
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
    imageUrl = `${normalizedBase}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
  }
  if (!imageUrl && fields.thumbnail_ext) {
    imageUrl = `${normalizedBase}/t/${fields.artifact_id}.${fields.thumbnail_ext}`;
  }
  if (!imageUrl) {
    imageUrl = `${normalizedBase}/brand/icon-512.png`;
  }

  return {
    title,
    description,
    imageUrl,
    canonicalUrl: `${normalizedBase}/a/${slug}/`,
  };
}

/** Render Open Graph + Twitter Card tags for link unfurling. */
export function renderSocialMetaTags(preview: SocialPreview): string {
  const title = escapeHtml(preview.title);
  const description = escapeHtml(preview.description);
  const image = escapeHtml(preview.imageUrl);
  const url = escapeHtml(preview.canonicalUrl);

  const tags = [
    preview.description ? `<meta name="description" content="${description}">` : '',
    `<meta property="og:title" content="${title}">`,
    preview.description ? `<meta property="og:description" content="${description}">` : '',
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="ShareOut">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    preview.description ? `<meta name="twitter:description" content="${description}">` : '',
    `<meta name="twitter:image" content="${image}">`,
  ].filter(Boolean);

  return `\n  ${tags.join('\n  ')}`;
}

/**
 * Minimal 200 page carrying only Open Graph tags for **public** artifact unfurls.
 * Do NOT use for private/workspace artifacts — that path used to leak titles to
 * Googlebot/Slackbot without auth. Closed content must go through the login gate.
 */
export function renderSocialPreviewPage(preview: SocialPreview): Response {
  const title = escapeHtml(preview.title);
  const description = escapeHtml(preview.description);
  const url = escapeHtml(preview.canonicalUrl);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>${renderSocialMetaTags(preview)}
  <link rel="canonical" href="${url}">
</head>
<body>
  <h1>${title}</h1>
  ${preview.description ? `<p>${description}</p>` : ''}
  <p><a href="${url}">View on ShareOut</a></p>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
