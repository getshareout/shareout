import { describe, expect, it } from 'vitest';
import { generateSlug, shortHash, validatePublishRequest } from '../../src/validation';
import type { PublishRequest, PWAConfig } from '../../src/types';

describe('shortHash', () => {
  it('is deterministic for the same input', () => {
    expect(shortHash('wsp_default')).toBe(shortHash('wsp_default'));
  });

  it('differs across workspaces so collided slugs get distinct suffixes', () => {
    expect(shortHash('wsp_a')).not.toBe(shortHash('wsp_b'));
  });

  it('returns a url-safe base36 string', () => {
    expect(shortHash('usr_1')).toMatch(/^[a-z0-9]+$/);
  });
});

/** Minimal base64 PNG payload (≥1KB decoded) for PWA icon validation. */
function fakePngIcon(decodedBytes = 2048): string {
  const header = 'iVBORw0KGgo';
  const padLen = Math.max(0, Math.ceil((decodedBytes * 4) / 3) - header.length);
  return header + 'A'.repeat(padLen);
}

const validPwa = (overrides: Partial<PWAConfig> = {}): PWAConfig => ({
  enabled: true,
  name: 'My App',
  short_name: 'App',
  icon: fakePngIcon(),
  ...overrides,
});

const validRequest = (overrides: Partial<PublishRequest> = {}): PublishRequest => ({
  name: 'Demo Artifact',
  files: [
    {
      path: 'index.html',
      content: '<h1>Hello</h1>',
      mime: 'text/html',
    },
  ],
  ...overrides,
});

describe('validatePublishRequest', () => {
  it('accepts a minimal valid publish request', () => {
    expect(validatePublishRequest(validRequest())).toBeNull();
  });

  it('requires a name and at least one file', () => {
    const error = validatePublishRequest({ name: ' ', files: [] });

    expect(error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(error?.details).toEqual(
      expect.arrayContaining([
        'name is required',
        'files array is required and must not be empty',
        'entrypoint "index.html" not found in files',
      ])
    );
  });

  it('rejects invalid slugs, duplicate paths, missing entrypoints, and unsafe files', () => {
    const error = validatePublishRequest(validRequest({
      slug: '-bad-slug-',
      entrypoint: 'missing.html',
      files: [
        { path: 'index.html', content: '<h1>Hello</h1>', mime: 'text/html' },
        { path: 'index.html', content: 'body{}', mime: 'text/css' },
        { path: '../secret.txt', content: 'nope', mime: 'text/plain' },
      ],
    }));

    expect(error?.details).toEqual(expect.arrayContaining([
      'slug must be lowercase alphanumeric with hyphens, cannot start/end with hyphen',
      'duplicate path: index.html',
      'invalid path "../secret.txt": must be relative, no traversal',
      'entrypoint "missing.html" not found in files',
    ]));
  });

  it('allows empty file content when the mime type is valid', () => {
    const error = validatePublishRequest(validRequest({
      files: [
        {
          path: 'index.html',
          content: '',
          mime: 'text/html',
        },
      ],
    }));

    expect(error).toBeNull();
  });
});

describe('generateSlug', () => {
  it('normalizes names into lowercase hyphenated slugs', () => {
    expect(generateSlug(' My Great Artifact! ')).toBe('my-great-artifact');
  });

  it('falls back when the name has no slug-safe characters', () => {
    expect(generateSlug('***')).toBe('artifact');
  });

  it('caps generated slugs at 50 characters', () => {
    expect(generateSlug('a'.repeat(80))).toHaveLength(50);
  });

  it('allows single-character slugs', () => {
    expect(generateSlug('x')).toBe('x');
  });
});

describe('validatePublishRequest file rules', () => {
  it('rejects missing path, content, and mime', () => {
    const error = validatePublishRequest(validRequest({
      files: [
        { path: '', content: 'x', mime: 'text/html' },
        { path: 'no-content.html', content: undefined as unknown as string, mime: 'text/html' },
        { path: 'no-mime.html', content: '<p></p>', mime: '' },
      ],
    }));

    expect(error?.details).toEqual(expect.arrayContaining([
      'file.path is required',
      'file.content is required for no-content.html',
      'file.mime is required for no-mime.html',
    ]));
  });

  it('rejects absolute paths', () => {
    const error = validatePublishRequest(validRequest({
      files: [
        { path: '/etc/passwd', content: 'x', mime: 'text/html' },
        { path: 'index.html', content: '<h1></h1>', mime: 'text/html' },
      ],
    }));

    expect(error?.details).toContain(
      'invalid path "/etc/passwd": must be relative, no traversal'
    );
  });

  it('accepts valid single-character slugs', () => {
    expect(validatePublishRequest(validRequest({ slug: 'a' }))).toBeNull();
  });

  it('counts base64-encoded file size toward limits', () => {
    const overLimit = 'A'.repeat(Math.ceil((100 * 1024 * 1024 + 1) / 0.75));
    const error = validatePublishRequest(validRequest({
      files: [
        { path: 'index.html', content: '<h1></h1>', mime: 'text/html' },
        { path: 'big.bin', content: overLimit, encoding: 'base64', mime: 'image/png' },
      ],
    }));

    expect(error?.details).toEqual(
      expect.arrayContaining([expect.stringMatching(/big\.bin exceeds 100MB limit/)])
    );
  });

  it('rejects per-file content over 100MB', () => {
    const error = validatePublishRequest(validRequest({
      files: [
        {
          path: 'index.html',
          content: 'x'.repeat(100 * 1024 * 1024 + 1),
          mime: 'text/html',
        },
      ],
    }));

    expect(error?.details).toEqual(
      expect.arrayContaining([expect.stringMatching(/index\.html exceeds 100MB limit/)])
    );
  });

  it('rejects publish requests whose combined file size exceeds 500MB', () => {
    const chunkSize = Math.floor((500 * 1024 * 1024) / 6) + 1;
    const error = validatePublishRequest(validRequest({
      files: [
        { path: 'index.html', content: '<h1></h1>', mime: 'text/html' },
        { path: 'a.bin', content: 'x'.repeat(chunkSize), mime: 'image/png' },
        { path: 'b.bin', content: 'x'.repeat(chunkSize), mime: 'image/png' },
        { path: 'c.bin', content: 'x'.repeat(chunkSize), mime: 'image/png' },
        { path: 'd.bin', content: 'x'.repeat(chunkSize), mime: 'image/png' },
        { path: 'e.bin', content: 'x'.repeat(chunkSize), mime: 'image/png' },
        { path: 'f.bin', content: 'x'.repeat(chunkSize), mime: 'image/png' },
      ],
    }));

    expect(error?.details).toEqual(
      expect.arrayContaining([expect.stringMatching(/total size .* exceeds limit of 500MB/)])
    );
  });
});

describe('validatePublishRequest PWA', () => {
  it('skips PWA validation when disabled', () => {
    expect(validatePublishRequest(validRequest({
      pwa: { enabled: false, name: '', short_name: '', icon: '' },
    }))).toBeNull();
  });

  it('requires name, short_name, and icon when enabled', () => {
    const error = validatePublishRequest(validRequest({
      pwa: { enabled: true, name: ' ', short_name: ' ', icon: '' },
    }));

    expect(error?.details).toEqual(expect.arrayContaining([
      'pwa.name is required when PWA is enabled',
      'pwa.short_name is required when PWA is enabled',
      'pwa.icon is required when PWA is enabled (base64-encoded PNG)',
    ]));
  });

  it('rejects short_name longer than 12 characters', () => {
    const error = validatePublishRequest(validRequest({
      pwa: validPwa({ short_name: 'thirteen-chars' }),
    }));

    expect(error?.details).toContain('pwa.short_name must be 12 characters or less');
  });

  it('rejects invalid theme and background colors', () => {
    const error = validatePublishRequest(validRequest({
      pwa: validPwa({ theme_color: 'blue', background_color: '#fff' }),
    }));

    expect(error?.details).toEqual(expect.arrayContaining([
      'pwa.theme_color must be a valid hex color (e.g., #3b82f6)',
      'pwa.background_color must be a valid hex color (e.g., #ffffff)',
    ]));
  });

  it('rejects invalid display and orientation', () => {
    const error = validatePublishRequest(validRequest({
      pwa: validPwa({ display: 'windowed' as PWAConfig['display'], orientation: 'sideways' as PWAConfig['orientation'] }),
    }));

    expect(error?.details).toEqual(expect.arrayContaining([
      'pwa.display must be one of: standalone, fullscreen, minimal-ui, browser',
      'pwa.orientation must be one of: any, portrait, landscape',
    ]));
  });

  it('accepts valid PWA options', () => {
    expect(validatePublishRequest(validRequest({
      pwa: validPwa({
        theme_color: '#3b82f6',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
      }),
    }))).toBeNull();
  });

  it('rejects icons without a PNG signature', () => {
    const error = validatePublishRequest(validRequest({
      pwa: validPwa({ icon: btoa('not-a-png') }),
    }));

    expect(error?.details).toEqual(
      expect.arrayContaining([expect.stringMatching(/valid PNG image/)])
    );
  });

  it('rejects icons that are too small, too large, or invalid base64', () => {
    const tooSmall = validatePublishRequest(validRequest({
      pwa: validPwa({ icon: 'iVBORw0KGgo' }),
    }));
    expect(tooSmall?.details).toContain(
      'pwa.icon appears too small - ensure it is a valid 512x512 PNG'
    );

    const tooLarge = validatePublishRequest(validRequest({
      pwa: validPwa({ icon: fakePngIcon(600 * 1024) }),
    }));
    expect(tooLarge?.details).toEqual(
      expect.arrayContaining([expect.stringMatching(/consider optimizing/)])
    );

    const badBase64 = validatePublishRequest(validRequest({
      pwa: validPwa({ icon: 'iVBORw0KGgo!!!' }),
    }));
    expect(badBase64?.details).toContain('pwa.icon contains invalid base64 data');
  });

  it('accepts data-uri prefixed PNG icons', () => {
    const icon = `data:image/png;base64,${fakePngIcon()}`;
    expect(validatePublishRequest(validRequest({ pwa: validPwa({ icon }) }))).toBeNull();
  });
});
