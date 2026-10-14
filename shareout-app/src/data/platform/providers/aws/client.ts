// Shared SigV4 plumbing for the AWS connectors (S3, Redshift Data API, RDS Data
// API). Every AWS call goes over HTTPS with aws4fetch — no TCP sockets — so it
// works from a Worker and reaches VPC-private Redshift/Aurora through AWS's own
// endpoints. Credentials are an IAM access key stored encrypted on the connection.

import { AwsClient } from 'aws4fetch';
import type { DecryptedCredentials } from '../../types';

export interface AwsKeys {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
}

/** Read the IAM key from a connection's decrypted credentials (`extra`). */
export function awsKeysFrom(credentials: DecryptedCredentials): AwsKeys | null {
	const x = credentials.extra || {};
	const accessKeyId = typeof x.access_key_id === 'string' ? x.access_key_id.trim() : '';
	const secretAccessKey = typeof x.secret_access_key === 'string' ? x.secret_access_key.trim() : '';
	if (!accessKeyId || !secretAccessKey) return null;
	const sessionToken = typeof x.session_token === 'string' && x.session_token.trim() ? x.session_token.trim() : undefined;
	return { accessKeyId, secretAccessKey, sessionToken };
}

export function awsClient(keys: AwsKeys, service: string, region: string): AwsClient {
	return new AwsClient({ ...keys, service, region });
}

/** AWS regions are lowercase letters, digits and dashes (e.g. us-east-1). */
export function validRegion(region: unknown): region is string {
	return typeof region === 'string' && /^[a-z]{2}(-[a-z]+)+-\d$/.test(region);
}

/** Pull the human message out of an AWS JSON error body, if there is one. */
export async function awsErrorMessage(res: Response): Promise<string> {
	const text = await res.text().catch(() => '');
	try {
		const j = JSON.parse(text) as { message?: string; Message?: string; __type?: string };
		const msg = j.message || j.Message;
		if (msg) return msg;
		if (j.__type) return j.__type.split('#').pop() || j.__type;
	} catch {
		const m = text.match(/<Message>([^<]*)<\/Message>/);
		if (m) return m[1];
		const c = text.match(/<Code>([^<]*)<\/Code>/);
		if (c) return c[1];
	}
	return `HTTP ${res.status}`;
}

export interface SqlResult {
	columns: string[];
	rows: Record<string, unknown>[];
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
