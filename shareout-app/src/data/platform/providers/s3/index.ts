import type { ProviderResponse, VerifyResult } from '../base-provider';
import type { ProviderEndpoint, ExecutionContext, RequestParams, DecryptedCredentials, Env } from '../../types';
import { StaticCredentialsProvider } from '../static-credentials-provider';
import { awsClient, awsErrorMessage, awsKeysFrom, validRegion, type AwsKeys } from '../aws/client';
import { registerProvider } from '../../registry';
import { parseCSVLine } from '../../../datasets/paginate';
import { S3_CONFIG } from './config';

export interface S3ConnectionConfig {
	bucket?: string;
	region?: string;
	/** S3-compatible endpoint (R2, MinIO, …), https only. Unset = AWS. */
	endpoint?: string;
	/** Optional root folder: every key/prefix this connector touches must start with it. */
	prefix?: string;
}

export interface S3Object {
	key: string;
	size: number;
	lastModified: string;
	etag: string;
}

const MAX_GET_BYTES = 10 * 1024 * 1024;
const MAX_PRESIGN_SECONDS = 3600;
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

function xmlDecode(s: string): string {
	return s
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
		.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

function tag(xml: string, name: string): string | undefined {
	const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
	return m ? xmlDecode(m[1]) : undefined;
}

function blocks(xml: string, name: string): string[] {
	return xml.match(new RegExp(`<${name}>[\\s\\S]*?</${name}>`, 'g')) || [];
}

/** Parse a ListObjectsV2 XML body. */
export function parseListObjects(xml: string) {
	const objects: S3Object[] = blocks(xml, 'Contents').map((c) => ({
		key: tag(c, 'Key') ?? '',
		size: Number(tag(c, 'Size') ?? 0),
		lastModified: tag(c, 'LastModified') ?? '',
		etag: (tag(c, 'ETag') ?? '').replace(/"/g, ''),
	}));
	const prefixes = blocks(xml, 'CommonPrefixes').map((p) => tag(p, 'Prefix') ?? '');
	return {
		objects,
		prefixes,
		isTruncated: tag(xml, 'IsTruncated') === 'true',
		nextContinuationToken: tag(xml, 'NextContinuationToken') ?? null,
	};
}

/** CSV text → row objects keyed by the header line (same parser as datasets). */
export function parseCsv(text: string): Record<string, string>[] {
	const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
	if (!lines.length) return [];
	const headers = parseCSVLine(lines[0]);
	return lines.slice(1).map((line) => {
		const values = parseCSVLine(line);
		const row: Record<string, string> = {};
		headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
		return row;
	});
}

type Format = 'csv' | 'json' | 'text';

function detectFormat(key: string, contentType: string, requested: unknown): Format | null {
	if (requested === 'csv' || requested === 'json' || requested === 'text') return requested;
	const ext = key.toLowerCase().split('.').pop() || '';
	if (ext === 'csv') return 'csv';
	if (ext === 'json' || ext === 'geojson' || contentType.includes('json')) return 'json';
	if (['txt', 'md', 'tsv', 'log', 'xml', 'html', 'yaml', 'yml', 'ndjson', 'jsonl'].includes(ext) || contentType.startsWith('text/')) return 'text';
	return null;
}

/** Validate the connection config; returns an error message or null. */
export function s3ConfigError(cfg: S3ConnectionConfig): string | null {
	if (!cfg.bucket || !BUCKET_RE.test(cfg.bucket)) return 'A valid bucket name is required';
	if (cfg.endpoint) {
		let u: URL;
		try { u = new URL(cfg.endpoint); } catch { return 'endpoint must be a URL'; }
		if (u.protocol !== 'https:') return 'endpoint must use https://';
		return null;
	}
	if (!validRegion(cfg.region)) return 'A valid AWS region is required (e.g. us-east-1)';
	return null;
}

export function s3ObjectUrl(cfg: S3ConnectionConfig, key = ''): string {
	const encKey = key.split('/').map(encodeURIComponent).join('/');
	if (cfg.endpoint) return `${cfg.endpoint.replace(/\/+$/, '')}/${cfg.bucket}/${encKey}`;
	// Dotted bucket names break the virtual-host TLS wildcard; use path style for them.
	if (cfg.bucket!.includes('.')) return `https://s3.${cfg.region}.amazonaws.com/${cfg.bucket}/${encKey}`;
	return `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${encKey}`;
}

function rootPrefix(cfg: S3ConnectionConfig): string {
	const p = (cfg.prefix || '').replace(/^\/+/, '');
	return p && !p.endsWith('/') ? `${p}/` : p;
}

function client(cfg: S3ConnectionConfig, keys: AwsKeys) {
	return awsClient(keys, 's3', cfg.endpoint ? (cfg.region || 'auto') : cfg.region!);
}

class S3Provider extends StaticCredentialsProvider {
	readonly config = S3_CONFIG;

	readonly endpoints = new Map<string, ProviderEndpoint>([
		['objects.list', {
			id: 'objects.list', method: 'GET', path: '/',
			description: 'List objects and folders. queryParams: prefix, delimiter (default "/"), continuationToken, maxKeys (≤1000)',
			cache: { ttlSeconds: 60 },
		}],
		['objects.get', {
			id: 'objects.get', method: 'GET', path: '/{key}',
			description: 'Read one object (≤10 MB). queryParams: key, format (csv|json|text; inferred from the extension). CSV returns rows.',
			cache: { ttlSeconds: 300 },
		}],
		['objects.presign', {
			id: 'objects.presign', method: 'POST', path: '/{key}',
			description: 'Mint a short-lived download URL for one object (large or binary files). body: key, expiresIn (seconds, ≤3600)',
		}],
	]);

	async verifyConnection(_env: Env, config: Record<string, unknown>, credentials: DecryptedCredentials): Promise<VerifyResult> {
		const cfg = config as S3ConnectionConfig;
		const bad = s3ConfigError(cfg);
		if (bad) return { ok: false, message: bad };
		const keys = awsKeysFrom(credentials);
		if (!keys) return { ok: false, message: 'Access key ID and secret access key are required' };
		const url = new URL(s3ObjectUrl(cfg));
		url.searchParams.set('list-type', '2');
		url.searchParams.set('max-keys', '1');
		if (rootPrefix(cfg)) url.searchParams.set('prefix', rootPrefix(cfg));
		const res = await client(cfg, keys).fetch(url.toString());
		if (!res.ok) return { ok: false, message: `S3 refused the request: ${await awsErrorMessage(res)}` };
		return { ok: true, message: `Can list s3://${cfg.bucket}/${rootPrefix(cfg)}` };
	}

	async executeRequest<T = unknown>(ctx: ExecutionContext, endpoint: ProviderEndpoint, params: RequestParams): Promise<ProviderResponse<T>> {
		const cfg = ctx.connectionConfig.config as S3ConnectionConfig;
		const bad = s3ConfigError(cfg);
		if (bad) return this.fail('S3_CONFIG', bad);
		const keys = awsKeysFrom(ctx.credentials);
		if (!keys) return this.fail('MISSING_CREDENTIALS', 'No AWS access key stored for this connection');
		const q = { ...(params.queryParams || {}), ...((params.body as Record<string, unknown>) || {}) } as Record<string, unknown>;
		const root = rootPrefix(cfg);
		const aws = client(cfg, keys);

		if (endpoint.id === 'objects.list') {
			const prefix = typeof q.prefix === 'string' ? q.prefix : root;
			if (!prefix.startsWith(root)) return this.fail('PREFIX_FORBIDDEN', `This connector is limited to "${root}"`, 403);
			const url = new URL(s3ObjectUrl(cfg));
			url.searchParams.set('list-type', '2');
			url.searchParams.set('delimiter', typeof q.delimiter === 'string' ? q.delimiter : '/');
			url.searchParams.set('max-keys', String(Math.min(Math.max(Number(q.maxKeys) || 1000, 1), 1000)));
			if (prefix) url.searchParams.set('prefix', prefix);
			if (typeof q.continuationToken === 'string' && q.continuationToken) url.searchParams.set('continuation-token', q.continuationToken);
			const res = await aws.fetch(url.toString());
			if (!res.ok) return this.fail(`S3_ERROR_${res.status}`, await awsErrorMessage(res), res.status);
			const list = parseListObjects(await res.text());
			return { success: true, status: 200, data: { bucket: cfg.bucket, prefix, ...list } as T };
		}

		const key = typeof q.key === 'string' ? q.key.replace(/^\/+/, '') : '';
		if (!key) return this.fail('MISSING_KEY', 'key is required');
		if (!key.startsWith(root)) return this.fail('PREFIX_FORBIDDEN', `This connector is limited to "${root}"`, 403);

		if (endpoint.id === 'objects.presign') {
			const expiresIn = Math.min(Math.max(Number(q.expiresIn) || 900, 60), MAX_PRESIGN_SECONDS);
			const url = new URL(s3ObjectUrl(cfg, key));
			url.searchParams.set('X-Amz-Expires', String(expiresIn));
			const signed = await aws.sign(url.toString(), { method: 'GET', aws: { signQuery: true } });
			return { success: true, status: 200, data: { key, url: signed.url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() } as T };
		}

		const res = await aws.fetch(s3ObjectUrl(cfg, key));
		if (!res.ok) return this.fail(`S3_ERROR_${res.status}`, res.status === 404 ? `No object at "${key}"` : await awsErrorMessage(res), res.status);
		const contentType = res.headers.get('content-type') || '';
		const size = Number(res.headers.get('content-length') || 0);
		const tooBig = `"${key}" is larger than 10 MB — use objects.presign to download it directly`;
		if (size > MAX_GET_BYTES) {
			await res.body?.cancel();
			return this.fail('OBJECT_TOO_LARGE', tooBig, 413);
		}
		const format = detectFormat(key, contentType, q.format);
		if (!format) {
			await res.body?.cancel();
			return this.fail('UNSUPPORTED_FORMAT', `"${key}" is not CSV, JSON or text — use objects.presign to download it`, 415);
		}
		const text = await res.text();
		if (text.length > MAX_GET_BYTES) return this.fail('OBJECT_TOO_LARGE', tooBig, 413);
		const meta = { key, contentType, size: size || text.length, lastModified: res.headers.get('last-modified'), format };
		if (format === 'csv') {
			const rows = parseCsv(text);
			return { success: true, status: 200, data: { ...meta, rowCount: rows.length, rows } as T };
		}
		if (format === 'json') {
			try {
				return { success: true, status: 200, data: { ...meta, data: JSON.parse(text) } as T };
			} catch {
				return this.fail('INVALID_JSON', `"${key}" is not valid JSON`, 422);
			}
		}
		return { success: true, status: 200, data: { ...meta, text } as T };
	}
}

const s3Provider = new S3Provider();
registerProvider(s3Provider);

export { s3Provider };
export { S3_CONFIG } from './config';
