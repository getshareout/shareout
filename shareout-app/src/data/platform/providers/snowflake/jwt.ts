// Snowflake key-pair (KEYPAIR_JWT) authentication for the SQL API.
//
// Snowflake's SQL API accepts a short-lived RS256 JWT signed with the user's RSA
// private key. The public key is registered on the Snowflake user
// (ALTER USER ... SET RSA_PUBLIC_KEY=...) and its fingerprint is reported by
// `DESC USER <user>` as RSA_PUBLIC_KEY_FP (e.g. "SHA256:abc..."). We mint and
// cache the JWT here, mirroring the BigQuery service-account signer.

export interface SnowflakeKeyPair {
	// Account identifier used in the JWT qualified username (NOT the host). For
	// locator accounts this is the locator without region (e.g. "XY12345"); for
	// org accounts it is "MYORG-MYACCOUNT". Always uppercase.
	account: string;
	user: string;
	// Full fingerprint as Snowflake reports it, e.g. "SHA256:base64==".
	publicKeyFingerprint: string;
	// Unencrypted PKCS#8 PEM ("-----BEGIN PRIVATE KEY-----").
	privateKey: string;
}

const JWT_LIFETIME_SECONDS = 3540; // 59 min; Snowflake caps key-pair JWTs at 1h.
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

function normalizeFingerprint(fp: string): string {
	const trimmed = fp.trim();
	return trimmed.startsWith('SHA256:') ? trimmed : `SHA256:${trimmed}`;
}

export async function getSnowflakeJwt(key: SnowflakeKeyPair): Promise<string> {
	const account = key.account.toUpperCase();
	const user = key.user.toUpperCase();
	const qualifiedUser = `${account}.${user}`;
	const fingerprint = normalizeFingerprint(key.publicKeyFingerprint);

	const now = Math.floor(Date.now() / 1000);
	const cacheKey = `${qualifiedUser}:${fingerprint}`;
	const cached = tokenCache.get(cacheKey);
	if (cached && cached.exp > now + 60) return cached.token;

	const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
	const claims = base64url(
		JSON.stringify({
			iss: `${qualifiedUser}.${fingerprint}`,
			sub: qualifiedUser,
			iat: now,
			exp: now + JWT_LIFETIME_SECONDS,
		})
	);
	const signingInput = `${header}.${claims}`;

	const cryptoKey = await crypto.subtle.importKey(
		'pkcs8',
		pemToDer(key.privateKey),
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		cryptoKey,
		new TextEncoder().encode(signingInput)
	);
	const jwt = `${signingInput}.${base64url(signature)}`;

	tokenCache.set(cacheKey, { token: jwt, exp: now + JWT_LIFETIME_SECONDS });
	return jwt;
}
