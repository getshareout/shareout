export interface AuthorizedUserKey {
	client_id: string;
	client_secret: string;
	refresh_token: string;
	token_uri?: string;
}

// Cache minted tokens per refresh token within the isolate so we don't hit the
// token endpoint on every query. Access tokens live ~1h.
const tokenCache = new Map<string, { token: string; exp: number }>();

export async function getAuthorizedUserToken(au: AuthorizedUserKey): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const cached = tokenCache.get(au.refresh_token);
	if (cached && cached.exp > now + 60) return cached.token;

	const tokenUri = au.token_uri || 'https://oauth2.googleapis.com/token';
	const res = await fetch(tokenUri, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: au.client_id,
			client_secret: au.client_secret,
			refresh_token: au.refresh_token,
			grant_type: 'refresh_token',
		}),
	});

	if (!res.ok) {
		throw new Error(`Authorized-user token refresh failed: ${await res.text()}`);
	}

	const data = (await res.json()) as { access_token: string; expires_in: number };
	tokenCache.set(au.refresh_token, { token: data.access_token, exp: now + data.expires_in });
	return data.access_token;
}
