import { AwsClient } from 'aws4fetch';
import type { Env } from '../types';

const DEFAULT_BUCKET = 'shareout-artifacts';

/** True when R2 S3-API credentials are configured for presigned direct transfers. */
export function isPresignConfigured(env: Env): boolean {
  return !!(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ACCOUNT_ID);
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
  const bucket = env.R2_BUCKET || DEFAULT_BUCKET;
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/${encodedKey}?X-Amz-Expires=${ttlSeconds}`;
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
