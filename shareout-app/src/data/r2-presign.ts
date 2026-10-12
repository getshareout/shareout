import { AwsClient } from 'aws4fetch';
import type { Env } from '../types';

/**
 * True when R2 S3-API credentials AND the bucket name are configured for presigned
 * direct transfers. R2_BUCKET must name the same bucket as the ARTIFACTS binding —
 * the binding doesn't expose its name, and guessing one sent direct uploads to a
 * different bucket than confirm/content read from.
 */
export function isPresignConfigured(env: Env): boolean {
  return !!(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ACCOUNT_ID && env.R2_BUCKET);
}

function client(env: Env): AwsClient {
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    service: 's3',
    region: 'auto',
  });
}

function objectUrl(env: Env, key: string, ttlSeconds: number): string {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${encodedKey}?X-Amz-Expires=${ttlSeconds}`;
}

async function presign(env: Env, key: string, method: 'GET' | 'PUT', ttlSeconds: number): Promise<string | null> {
  if (!isPresignConfigured(env)) return null;
  const signed = await client(env).sign(objectUrl(env, key, ttlSeconds), {
    method,
    aws: { signQuery: true },
  });
  return signed.url;
}

/** Presigned GET URL for direct-from-R2 download. Returns null when unconfigured. */
export function presignGet(env: Env, key: string, ttlSeconds = 300): Promise<string | null> {
  return presign(env, key, 'GET', ttlSeconds);
}

/** Presigned PUT URL for direct-to-R2 upload. Returns null when unconfigured. */
export function presignPut(env: Env, key: string, ttlSeconds = 900): Promise<string | null> {
  return presign(env, key, 'PUT', ttlSeconds);
}
