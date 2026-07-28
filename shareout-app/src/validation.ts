import type { PublishRequest, FileEntry, ApiError, PWAConfig, ArtifactType } from './types';

const ALLOWED_MIMES = new Set([
  'text/html',
  'text/css',
  'text/javascript',
  'application/javascript',
  'application/json',
  'text/csv',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'font/woff',
  'font/woff2',
  'application/pdf',
]);

const MIME_TO_TYPE: Record<string, ArtifactType> = {
  'text/html': 'html',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'application/json': 'json',
  'application/pdf': 'pdf',
};

const EXTENSION_TO_TYPE: Record<string, ArtifactType> = {
  '.html': 'html',
  '.htm': 'html',
  '.csv': 'csv',
  '.txt': 'txt',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.json': 'json',
  '.pdf': 'pdf',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.avif': 'image',
  '.svg': 'image',
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
};

export function detectArtifactType(
  files: FileEntry[],
  entrypoint?: string,
  explicitType?: ArtifactType
): ArtifactType {
  if (explicitType) return explicitType;

  const mainFile = entrypoint
    ? files.find(f => f.path === entrypoint)
    : files[0];

  if (!mainFile) return 'html';

  if (MIME_TO_TYPE[mainFile.mime]) {
    return MIME_TO_TYPE[mainFile.mime];
  }

  if (mainFile.mime.startsWith('image/')) return 'image';
  if (mainFile.mime.startsWith('video/')) return 'video';

  const ext = mainFile.path.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (ext && EXTENSION_TO_TYPE[ext]) {
    return EXTENSION_TO_TYPE[ext];
  }

  return 'html';
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB per file
const MAX_TOTAL_SIZE = 500 * 1024 * 1024; // 500MB total
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const SEMVER_REGEX = /^\d+\.\d+\.\d+([-+].+)?$/;

export function validatePublishRequest(req: PublishRequest): ApiError | null {
  const errors: string[] = [];

  if (!req.name?.trim()) {
    errors.push('name is required');
  }

  if (req.slug && !SLUG_REGEX.test(req.slug)) {
    errors.push('slug must be lowercase alphanumeric with hyphens, cannot start/end with hyphen');
  }

  if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
    errors.push('files array is required and must not be empty');
  }

  const entrypoint = req.entrypoint || 'index.html';
  const paths = new Set<string>();
  let totalSize = 0;

  for (const file of req.files || []) {
    const fileErrors = validateFile(file);
    errors.push(...fileErrors);

    if (file.path) {
      if (paths.has(file.path)) {
        errors.push(`duplicate path: ${file.path}`);
      }
      paths.add(file.path);
    }

    if (file.content) {
      const size = file.encoding === 'base64'
        ? Math.ceil(file.content.length * 0.75)
        : file.content.length;
      totalSize += size;
    }
  }

  if (!paths.has(entrypoint)) {
    errors.push(`entrypoint "${entrypoint}" not found in files`);
  }

  if (totalSize > MAX_TOTAL_SIZE) {
    errors.push(`total size ${(totalSize / 1024 / 1024).toFixed(1)}MB exceeds limit of ${MAX_TOTAL_SIZE / 1024 / 1024}MB`);
  }

  if (req.pwa) {
    const pwaErrors = validatePWAConfig(req.pwa);
    errors.push(...pwaErrors);
  }

  // Workspace Library: require a semver and a present main JS file (the served module).
  if (req.artifact_type === 'library') {
    const lib = req.library;
    if (!lib?.version || !SEMVER_REGEX.test(lib.version)) {
      errors.push('library.version is required and must be semver (e.g. 1.0.0)');
    }
    const main = lib?.main || 'index.js';
    if (!paths.has(main)) {
      errors.push(`library main "${main}" not found in files`);
    }
  }

  if (errors.length > 0) {
    return { error: 'Validation failed', code: 'VALIDATION_ERROR', details: errors };
  }

  return null;
}

function validateFile(file: FileEntry): string[] {
  const errors: string[] = [];

  if (!file.path) {
    errors.push('file.path is required');
    return errors;
  }

  if (file.path.includes('..') || file.path.startsWith('/')) {
    errors.push(`invalid path "${file.path}": must be relative, no traversal`);
  }

  if (!file.content && file.content !== '') {
    errors.push(`file.content is required for ${file.path}`);
  }

  if (!file.mime) {
    errors.push(`file.mime is required for ${file.path}`);
  } else if (!ALLOWED_MIMES.has(file.mime)) {
    errors.push(`mime type "${file.mime}" not allowed for ${file.path}`);
  }

  if (file.content) {
    const size = file.encoding === 'base64'
      ? Math.ceil(file.content.length * 0.75)
      : file.content.length;
    if (size > MAX_FILE_SIZE) {
      errors.push(`file ${file.path} exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`);
    }
  }

  return errors;
}

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'artifact';
}

// Cheap, stable, deterministic string hash (djb2) → base36. Used to derive a
// stable routing-slug suffix when a human slug collides across workspaces, so a
// re-publish always lands on the same canonical /a/<slug>.
export function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const PNG_SIGNATURE_BASE64 = 'iVBORw0KGgo'; // \x89PNG\r\n\x1a\n in base64
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

function validatePWAConfig(pwa: PWAConfig): string[] {
  const errors: string[] = [];

  if (!pwa.enabled) {
    return errors;
  }

  if (!pwa.name?.trim()) {
    errors.push('pwa.name is required when PWA is enabled');
  }

  if (!pwa.short_name?.trim()) {
    errors.push('pwa.short_name is required when PWA is enabled');
  } else if (pwa.short_name.length > 12) {
    errors.push('pwa.short_name must be 12 characters or less');
  }

  if (!pwa.icon) {
    errors.push('pwa.icon is required when PWA is enabled (base64-encoded PNG)');
  } else {
    const iconErrors = validatePWAIcon(pwa.icon);
    errors.push(...iconErrors);
  }

  if (pwa.theme_color && !HEX_COLOR_REGEX.test(pwa.theme_color)) {
    errors.push('pwa.theme_color must be a valid hex color (e.g., #3b82f6)');
  }

  if (pwa.background_color && !HEX_COLOR_REGEX.test(pwa.background_color)) {
    errors.push('pwa.background_color must be a valid hex color (e.g., #ffffff)');
  }

  if (pwa.display && !['standalone', 'fullscreen', 'minimal-ui', 'browser'].includes(pwa.display)) {
    errors.push('pwa.display must be one of: standalone, fullscreen, minimal-ui, browser');
  }

  if (pwa.orientation && !['any', 'portrait', 'landscape'].includes(pwa.orientation)) {
    errors.push('pwa.orientation must be one of: any, portrait, landscape');
  }

  return errors;
}

function validatePWAIcon(icon: string): string[] {
  const errors: string[] = [];

  const base64Data = icon.replace(/^data:image\/\w+;base64,/, '');

  if (!base64Data.startsWith(PNG_SIGNATURE_BASE64)) {
    errors.push('pwa.icon must be a valid PNG image (missing PNG signature). Ensure the image starts with the PNG header bytes.');
  }

  try {
    const decoded = atob(base64Data);
    const sizeKB = decoded.length / 1024;

    if (sizeKB < 1) {
      errors.push('pwa.icon appears too small - ensure it is a valid 512x512 PNG');
    }

    if (sizeKB > 500) {
      errors.push(`pwa.icon is ${sizeKB.toFixed(0)}KB - consider optimizing (recommended < 100KB)`);
    }
  } catch {
    errors.push('pwa.icon contains invalid base64 data');
  }

  return errors;
}

import type { TypeMetadata, CsvTypeMetadata, MarkdownTypeMetadata, JsonTypeMetadata, TxtTypeMetadata, ImageTypeMetadata, VideoTypeMetadata, SkillTypeMetadata } from './types';

export function generateTypeMetadata(
  artifactType: ArtifactType,
  content: string,
  mime: string
): TypeMetadata {
  switch (artifactType) {
    case 'csv':
      return { csv: generateCsvMetadata(content) };
    case 'markdown':
      return { markdown: generateMarkdownMetadata(content) };
    case 'json':
      return { json: generateJsonMetadata(content) };
    case 'txt':
      return { txt: generateTxtMetadata(content) };
    case 'image':
      return { image: generateImageMetadata(mime) };
    case 'video':
      return { video: generateVideoMetadata(mime) };
    case 'skill':
      return { skill: generateSkillMetadata(content) };
    case 'library':
      // Markdown-derived base (the README's TOC/code-block flags). The module fields
      // (name/version/main/exports/namespace/scope) are overlaid in publishArtifact
      // from the explicit publish body, not parsed from the README.
      return { library: { ...generateMarkdownMetadata(content) } };
    default:
      return {};
  }
}

function generateSkillMetadata(content: string): SkillTypeMetadata {
  const md = generateMarkdownMetadata(content);
  const fm = md.frontmatter || {};
  const tags = Array.isArray(fm.tags)
    ? (fm.tags as unknown[]).map(String)
    : typeof fm.tags === 'string'
      ? (fm.tags as string).split(',').map(t => t.trim()).filter(Boolean)
      : undefined;
  const summary = typeof fm.summary === 'string' ? fm.summary
    : typeof fm.description === 'string' ? fm.description
    : firstParagraph(content);
  return {
    ...md,
    summary: summary || undefined,
    category: typeof fm.category === 'string' ? fm.category : undefined,
    tags: tags && tags.length ? tags : undefined,
    version: fm.version != null ? String(fm.version) : undefined,
  };
}

function firstParagraph(content: string): string {
  const body = content.replace(/^---\n[\s\S]*?\n---\s*/, '');
  for (const block of body.split(/\n\s*\n/)) {
    const line = block.trim();
    if (line && !line.startsWith('#') && !line.startsWith('```')) {
      return line.replace(/\s+/g, ' ').slice(0, 280);
    }
  }
  return '';
}

function generateCsvMetadata(content: string): CsvTypeMetadata {
  const lines = content.split('\n').filter(line => line.trim());
  const delimiter = detectCsvDelimiter(content);
  const firstLine = lines[0] || '';
  const columns: Array<{ name: string; type: 'string' | 'number' | 'date' | 'boolean' }> = firstLine.split(delimiter).map((col, i) => ({
    name: col.trim().replace(/^["']|["']$/g, '') || `column_${i + 1}`,
    type: 'string' as const,
  }));

  if (lines.length > 1) {
    const secondLine = lines[1].split(delimiter);
    columns.forEach((col, i) => {
      const val = secondLine[i]?.trim().replace(/^["']|["']$/g, '') || '';
      col.type = inferColumnType(val);
    });
  }

  return {
    hasHeaders: true,
    delimiter,
    columns,
    rowCount: Math.max(0, lines.length - 1),
  };
}

function detectCsvDelimiter(content: string): string {
  const firstLine = content.split('\n')[0] || '';
  const delimiters = [',', ';', '\t', '|'];
  let maxCount = 0;
  let detected = ',';

  for (const d of delimiters) {
    const count = (firstLine.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length;
    if (count > maxCount) {
      maxCount = count;
      detected = d;
    }
  }

  return detected;
}

function inferColumnType(value: string): 'string' | 'number' | 'date' | 'boolean' {
  if (/^(true|false)$/i.test(value)) return 'boolean';
  if (!isNaN(Number(value)) && value !== '') return 'number';
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
  return 'string';
}

function generateMarkdownMetadata(content: string): MarkdownTypeMetadata {
  const toc: Array<{ level: number; text: string; anchor: string }> = [];
  const headerRegex = /^(#{1,6})\s+(.+)$/gm;
  let match;

  while ((match = headerRegex.exec(content)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const anchor = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    toc.push({ level, text, anchor });
  }

  const hasCodeBlocks = /```[\s\S]*?```|`[^`]+`/.test(content);

  let frontmatter: Record<string, unknown> | undefined;
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    try {
      frontmatter = parseSimpleYaml(fmMatch[1]);
    } catch {
      // Invalid frontmatter, ignore
    }
  }

  return { toc, hasCodeBlocks, frontmatter };
}

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      const key = match[1];
      let value: string | number | boolean = match[2].trim();
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (!isNaN(Number(value)) && value !== '') value = Number(value);
      else if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      result[key] = value;
    }
  }

  return result;
}

function generateJsonMetadata(content: string): JsonTypeMetadata {
  try {
    const parsed = JSON.parse(content);
    const isFormatted = content.includes('\n') && (content.includes('  ') || content.includes('\t'));

    if (Array.isArray(parsed)) {
      return {
        schema: 'array',
        itemCount: parsed.length,
        isFormatted,
      };
    } else if (typeof parsed === 'object' && parsed !== null) {
      return {
        schema: 'object',
        rootKeys: Object.keys(parsed).slice(0, 20),
        isFormatted,
      };
    } else {
      return {
        schema: 'primitive',
        isFormatted: false,
      };
    }
  } catch {
    return {
      schema: 'object',
      isFormatted: false,
    };
  }
}

function generateTxtMetadata(content: string): TxtTypeMetadata {
  const lines = content.split('\n');
  return {
    lineCount: lines.length,
    encoding: 'utf-8',
    charCount: content.length,
  };
}

function generateImageMetadata(mime: string): ImageTypeMetadata {
  const format = mime.replace('image/', '');
  return { format };
}

function generateVideoMetadata(mime: string): VideoTypeMetadata {
  const format = mime.replace('video/', '');
  return { format };
}
