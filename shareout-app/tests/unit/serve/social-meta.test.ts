import { describe, expect, it } from 'vitest';
import {
  extractSocialMetaFromHtml,
  renderSocialMetaTags,
  renderSocialPreviewPage,
  resolveArtifactSocialPreview,
} from '../../../src/serve/social-meta';

describe('extractSocialMetaFromHtml', () => {
  it('reads Open Graph tags from artifact HTML', () => {
    const html = `<!doctype html>
<html>
<head>
  <title>Fallback Title</title>
  <meta property="og:title" content="Q4 Review">
  <meta property="og:description" content="Quarterly business review">
  <meta property="og:image" content="https://cdn.example.com/preview.png">
</head>
<body></body>
</html>`;

    expect(extractSocialMetaFromHtml(html)).toEqual({
      title: 'Q4 Review',
      description: 'Quarterly business review',
      imageUrl: 'https://cdn.example.com/preview.png',
    });
  });

  it('handles apostrophes inside double-quoted content values', () => {
    const html = `<html><head>
      <meta property="og:title" content="Eliel's FIRE Planner">
      <meta property="og:description" content="It's a calculator">
    </head></html>`;

    expect(extractSocialMetaFromHtml(html)).toEqual({
      title: "Eliel's FIRE Planner",
      description: "It's a calculator",
      imageUrl: null,
    });
  });

  it('falls back to document title and meta description', () => {
    const html = `<html><head>
      <title>Deck Title</title>
      <meta name="description" content="A short summary">
    </head></html>`;

    expect(extractSocialMetaFromHtml(html)).toEqual({
      title: 'Deck Title',
      description: 'A short summary',
      imageUrl: null,
    });
  });
});

describe('resolveArtifactSocialPreview', () => {
  it('prefers social overrides and generated thumbnails', () => {
    const preview = resolveArtifactSocialPreview(
      {
        artifact_id: 'art_123',
        artifact_name: 'Internal Name',
        description: 'Artifact description',
        social_title: 'Shared Title',
        social_description: 'Shared description',
        social_image_url: null,
        thumbnail_ext: 'webp',
      },
      'https://shareout.site',
      'sales-dashboard',
    );

    expect(preview).toEqual({
      title: 'Shared Title',
      description: 'Shared description',
      imageUrl: 'https://shareout.site/t/art_123.webp',
      canonicalUrl: 'https://shareout.site/a/sales-dashboard/',
    });
  });

  it('uses the brand fallback image when no thumbnail exists', () => {
    const preview = resolveArtifactSocialPreview(
      {
        artifact_id: 'art_123',
        artifact_name: 'Report',
        description: null,
        social_title: null,
        social_description: null,
        social_image_url: null,
        thumbnail_ext: null,
      },
      'https://shareout.site',
      'report',
    );

    expect(preview.imageUrl).toBe('https://shareout.site/brand/icon-512.png');
    expect(preview.title).toBe('Report');
  });
});

describe('renderSocialMetaTags', () => {
  it('escapes values embedded in meta tags', () => {
    const tags = renderSocialMetaTags({
      title: 'Q4 <Review>',
      description: 'Sales & "Growth"',
      imageUrl: 'https://shareout.site/t/art_1.webp',
      canonicalUrl: 'https://shareout.site/a/demo/',
    });

    expect(tags).toContain('property="og:title" content="Q4 &lt;Review&gt;"');
    expect(tags).toContain('property="og:description" content="Sales &amp; &quot;Growth&quot;"');
    expect(tags).toContain('name="twitter:card" content="summary_large_image"');
  });
});

describe('renderSocialPreviewPage', () => {
  it('returns a 200 HTML page carrying the OG tags', async () => {
    const res = renderSocialPreviewPage({
      title: 'Eliel FIRE Planner',
      description: 'Plan your path to financial independence',
      imageUrl: 'https://shareout.site/t/art_1.webp',
      canonicalUrl: 'https://shareout.site/a/eliel-fire/',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('property="og:title" content="Eliel FIRE Planner"');
    expect(html).toContain('property="og:image" content="https://shareout.site/t/art_1.webp"');
    expect(html).toContain('href="https://shareout.site/a/eliel-fire/"');
  });
});
