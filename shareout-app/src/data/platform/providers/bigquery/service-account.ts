export interface ServiceAccountKey {
	client_email: string;
	private_key: string;
	token_uri?: string;
}

// Cache minted tokens per service-account key + scope within the isolate to avoid
// re-signing a JWT on every query. The key covers the private key, not just the
// email, so a cached token is only returned to a caller holding the same key. Tokens live ~1h; we refresh once they're within 60s of expiry.
const tokenCache = new Map<string, { token: string; exp: number }>();

function base64url(input: ArrayBuffer | string): string {
	const bytes =
		typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem: string): ArrayBuffer {
	const b64 = pem
		.replace(/-----BEGIN [^-]+-----/, '')
		.replace(/-----END [^-]+-----/, '')
		.replace(/\s+/g, '');
	const bin = atob(b64);
	const buf = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
	return buf.buffer;
}

async function cacheKeyFor(sa: ServiceAccountKey, scope: string): Promise<string> {
	const input = [sa.client_email, sa.private_key, sa.token_uri || '', scope].join('\n');
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
	return base64url(digest);
}

export async function getServiceAccountToken(
	sa: ServiceAccountKey,
	scope: string
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const cacheKey = await cacheKeyFor(sa, scope);
	const cached = tokenCache.get(cacheKey);
	if (cached && cached.exp > now + 60) return cached.token;

	const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
	const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
	const claims = base64url(
		JSON.stringify({ iss: sa.client_email, scope, aud: tokenUri, iat: now, exp: now + 3600 })
	);
	const signingInput = `${header}.${claims}`;

	const key = await crypto.subtle.importKey(
		'pkcs8',
		pemToDer(sa.private_key),
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		key,
		new TextEncoder().encode(signingInput)
	);
	const jwt = `${signingInput}.${base64url(signature)}`;

	const res = await fetch(tokenUri, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: jwt,
		}),
	});

	if (!res.ok) {
		throw new Error(`Service account token exchange failed: ${await res.text()}`);
	}

	const data = (await res.json()) as { access_token: string; expires_in: number };
	tokenCache.set(cacheKey, { token: data.access_token, exp: now + data.expires_in });
	return data.access_token;
}
