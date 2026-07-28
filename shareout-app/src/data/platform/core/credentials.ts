import type {
	Env,
	DecryptedCredentials,
	DirectCredentials,
	CredentialExchangeResult,
	ConnectionConfig,
	ExecutionMode,
} from '../types';
import type { BaseProvider } from '../providers/base-provider';
import { decryptCredentials, encryptCredentials } from '../../connections/credentials';

const DIRECT_CREDENTIAL_TTL_MS = 5 * 60 * 1000;
const PROXY_TOKEN_TTL_MS = 60 * 1000;

// One row shape for both scopes now — `scope_id` is the artifact id or the
// workspace id, depending on `scope_type`.
interface ConnectionRow {
	id: string;
	scope_type: 'artifact' | 'workspace';
	scope_id: string;
	name: string;
	provider: string;
	config: string;
	encrypted_credentials: string;
	iv: string;
	preferred_mode: ExecutionMode;
	created_at: string;
	updated_at: string;
	credential_scope: string | null;
}

export type ConnectionScope = 'artifact' | 'workspace';
export type CredentialScope = 'shared' | 'per_user';

export type ResolvedConnection = ConnectionConfig & {
	encryptedCredentials: string;
	iv: string;
	scope: ConnectionScope;
	ownerKey: string;
	// 'per_user' when each member supplies their own credentials; the loaded blob
	// then belongs to `requesterUserId`, not the shared connection row.
	credentialScope: CredentialScope;
	requesterUserId?: string | null;
};

// Thrown by loadConnection when a per_user connection has no credentials stored
// for the requesting user (or no user could be resolved).
export const CREDENTIALS_REQUIRED = 'CREDENTIALS_REQUIRED';

async function getArtifactWorkspaceId(env: Env, artifactId: string): Promise<string | null> {
	const row = await env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?')
		.bind(artifactId)
		.first<{ workspace_id: string | null }>();
	return row?.workspace_id || null;
}

function mapWorkspaceConnection(row: ConnectionRow): ResolvedConnection {
	return {
		id: row.id,
		name: row.name,
		provider: row.provider,
		preferredMode: row.preferred_mode,
		config: JSON.parse(row.config),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		encryptedCredentials: row.encrypted_credentials,
		iv: row.iv,
		scope: 'workspace',
		ownerKey: row.scope_id,
		credentialScope: 'shared',
	};
}

// For a per_user workspace connection, resolve the requesting user's own stored
// credential blob in place of the (empty) shared one. Throws CREDENTIALS_REQUIRED
// when the user has none, so the engine can surface a 403 the SDK understands.
async function resolvePerUserConnection(
	env: Env,
	wrow: ConnectionRow,
	requesterUserId: string | null | undefined
): Promise<ResolvedConnection> {
	if (!requesterUserId) throw new Error(CREDENTIALS_REQUIRED);
	const cred = await env.DB.prepare(
		`SELECT encrypted_credentials, iv FROM connection_user_credentials
		   WHERE connection_id = ? AND user_id = ?`
	)
		.bind(wrow.id, requesterUserId)
		.first<{ encrypted_credentials: string; iv: string }>();
	if (!cred) throw new Error(CREDENTIALS_REQUIRED);
	return {
		...mapWorkspaceConnection(wrow),
		encryptedCredentials: cred.encrypted_credentials,
		iv: cred.iv,
		credentialScope: 'per_user',
		requesterUserId,
	};
}

// Resolve a workspace-scoped platform connection directly by workspace id — no
// artifact anchor. Used by the workspace-level assistant, which has a workspace
// in hand but no artifact. Mirrors the workspace branch of loadConnection.
export async function loadWorkspaceConnection(
	env: Env,
	workspaceId: string,
	connectionId: string,
	requesterUserId?: string | null
): Promise<ResolvedConnection> {
	const wrow = await env.DB.prepare(`
		SELECT * FROM connections
		WHERE scope_type = 'workspace' AND scope_id = ? AND id = ? AND kind = 'platform'
	`)
		.bind(workspaceId, connectionId)
		.first<ConnectionRow>();
	if (!wrow) throw new Error('Connection not found');
	if (wrow.credential_scope === 'per_user') {
		return await resolvePerUserConnection(env, wrow, requesterUserId);
	}
	return mapWorkspaceConnection(wrow);
}

export async function loadConnection(
	env: Env,
	artifactId: string,
	connectionId: string,
	requesterUserId?: string | null
): Promise<ResolvedConnection> {
	const row = await env.DB.prepare(`
		SELECT * FROM connections
		WHERE scope_type = 'artifact' AND scope_id = ? AND id = ? AND kind = 'platform'
	`)
		.bind(artifactId, connectionId)
		.first<ConnectionRow>();

	if (row) {
		return {
			id: row.id,
			name: row.name,
			provider: row.provider,
			preferredMode: row.preferred_mode,
			config: JSON.parse(row.config),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			encryptedCredentials: row.encrypted_credentials,
			iv: row.iv,
			scope: 'artifact',
			ownerKey: artifactId,
			credentialScope: 'shared',
		};
	}

	const workspaceId = await getArtifactWorkspaceId(env, artifactId);
	if (workspaceId) {
		const wrow = await env.DB.prepare(`
			SELECT * FROM connections
			WHERE scope_type = 'workspace' AND scope_id = ? AND id = ? AND kind = 'platform'
		`)
			.bind(workspaceId, connectionId)
			.first<ConnectionRow>();

		if (wrow) {
			if (wrow.credential_scope === 'per_user') {
				return await resolvePerUserConnection(env, wrow, requesterUserId);
			}
			return mapWorkspaceConnection(wrow);
		}
	}

	throw new Error('Connection not found');
}

export async function loadConnectionByName(
	env: Env,
	artifactId: string,
	name: string
): Promise<ConnectionConfig & { encryptedCredentials: string; iv: string }> {
	const row = await env.DB.prepare(`
		SELECT * FROM connections
		WHERE scope_type = 'artifact' AND scope_id = ? AND name = ? AND kind = 'platform'
	`)
		.bind(artifactId, name)
		.first<ConnectionRow>();

	if (!row) {
		throw new Error('Connection not found');
	}

	return {
		id: row.id,
		name: row.name,
		provider: row.provider,
		preferredMode: row.preferred_mode,
		config: JSON.parse(row.config),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		encryptedCredentials: row.encrypted_credentials,
		iv: row.iv,
	};
}

export async function getDecryptedCredentials(
	encryptedCredentials: string,
	iv: string,
	secretKey: string
): Promise<DecryptedCredentials> {
	const raw = await decryptCredentials(encryptedCredentials, iv, secretKey);
	return {
		access_token: raw.access_token as string,
		refresh_token: raw.refresh_token as string | undefined,
		expires_at: raw.expires_at as number | undefined,
		extra: raw.extra as Record<string, unknown> | undefined,
	};
}

export async function saveCredentials(
	env: Env,
	target: {
		scope: ConnectionScope;
		ownerKey: string;
		connectionId: string;
		credentialScope?: CredentialScope;
		requesterUserId?: string | null;
	},
	credentials: DecryptedCredentials,
	secretKey: string
): Promise<void> {
	const { encrypted, iv } = await encryptCredentials(
		{
			access_token: credentials.access_token,
			refresh_token: credentials.refresh_token,
			expires_at: credentials.expires_at,
			extra: credentials.extra,
		},
		secretKey
	);

	// Per-user connections write the refreshed token back to the requester's own
	// row, never the shared connection blob.
	if (target.credentialScope === 'per_user' && target.requesterUserId) {
		await env.DB.prepare(`
			UPDATE connection_user_credentials
			SET encrypted_credentials = ?, iv = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
			WHERE connection_id = ? AND user_id = ?
		`)
			.bind(encrypted, iv, target.connectionId, target.requesterUserId)
			.run();
		return;
	}

	// Same table either way; `scope_type` + `scope_id` say which owner's row it is.
	await env.DB.prepare(`
		UPDATE connections
		SET encrypted_credentials = ?, iv = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		WHERE scope_type = ? AND scope_id = ? AND id = ?
	`)
		.bind(encrypted, iv, target.scope, target.ownerKey, target.connectionId)
		.run();
}

export async function prepareCredentialsForRequest(
	env: Env,
	artifactId: string,
	connectionId: string,
	provider: BaseProvider,
	mode: ExecutionMode,
	requesterUserId?: string | null
): Promise<CredentialExchangeResult> {
	const connection = await loadConnection(env, artifactId, connectionId, requesterUserId);
	const decrypted = await getDecryptedCredentials(
		connection.encryptedCredentials,
		connection.iv,
		env.CREDENTIALS_KEY!
	);

	if (decrypted.expires_at && decrypted.expires_at < Date.now() + 60000) {
		if (decrypted.refresh_token && provider.config.auth.refreshable) {
			const refreshed = await provider.refreshToken(
				{
					artifactId,
					connectionId,
					callbackUrl: '',
					state: '',
					params: connection.config as Record<string, string>,
					env,
				},
				decrypted.refresh_token
			);

			decrypted.access_token = refreshed.accessToken;
			decrypted.refresh_token = refreshed.refreshToken || decrypted.refresh_token;
			decrypted.expires_at = refreshed.expiresAt;

				await saveCredentials(
					env,
					{
						scope: connection.scope,
						ownerKey: connection.ownerKey,
						connectionId: connection.id,
						credentialScope: connection.credentialScope,
						requesterUserId: connection.requesterUserId,
					},
					decrypted,
					env.CREDENTIALS_KEY!
				);
		}
	}

	if (mode === 'direct' && provider.supportsDirectMode()) {
		const directCreds = await provider.prepareDirectCredentials(
			{
				artifactId,
				connectionId,
				callbackUrl: '',
				state: '',
				params: connection.config as Record<string, string>,
				env,
			},
			decrypted
		);

		return {
			mode: 'direct',
			direct: directCreds,
			expiresAt: Date.now() + DIRECT_CREDENTIAL_TTL_MS,
		};
	}

	const proxyToken = await issueProxyToken(env, {
		artifactId,
		connectionId,
		provider: provider.config.id,
	});

	return {
		mode: 'proxy',
		proxyToken,
		expiresAt: Date.now() + PROXY_TOKEN_TTL_MS,
	};
}

interface ProxyTokenPayload {
	artifactId: string;
	connectionId: string;
	provider: string;
}

async function issueProxyToken(env: Env, payload: ProxyTokenPayload): Promise<string> {
	const data = {
		...payload,
		issuedAt: Date.now(),
		expiresAt: Date.now() + PROXY_TOKEN_TTL_MS,
	};

	const { encrypted, iv } = await encryptCredentials(data, env.CREDENTIALS_KEY!);
	return `${encrypted}.${iv}`;
}

export async function verifyProxyToken(
	env: Env,
	token: string
): Promise<ProxyTokenPayload | null> {
	try {
		const [encrypted, iv] = token.split('.');
		if (!encrypted || !iv) {
			return null;
		}

		const data = await decryptCredentials(encrypted, iv, env.CREDENTIALS_KEY!);

		if ((data.expiresAt as number) < Date.now()) {
			return null;
		}

		return {
			artifactId: data.artifactId as string,
			connectionId: data.connectionId as string,
			provider: data.provider as string,
		};
	} catch {
		return null;
	}
}

export async function createConnection(
	env: Env,
	artifactId: string,
	data: {
		name: string;
		provider: string;
		config: Record<string, unknown>;
		credentials: DecryptedCredentials;
		preferredMode?: ExecutionMode;
	}
): Promise<string> {
	const id = `conn_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;

	const { encrypted, iv } = await encryptCredentials(
		{
			access_token: data.credentials.access_token,
			refresh_token: data.credentials.refresh_token,
			expires_at: data.credentials.expires_at,
			extra: data.credentials.extra,
		},
		env.CREDENTIALS_KEY!
	);

	await env.DB.prepare(`
		INSERT INTO connections (
			id, scope_type, scope_id, name, kind, provider, config,
			encrypted_credentials, iv, preferred_mode,
			created_at, updated_at
		)
		VALUES (?, 'artifact', ?, ?, 'platform', ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	`)
		.bind(
			id,
			artifactId,
			data.name,
			data.provider,
			JSON.stringify(data.config),
			encrypted,
			iv,
			data.preferredMode || 'auto'
		)
		.run();

	return id;
}

export async function deleteConnection(
	env: Env,
	artifactId: string,
	connectionId: string
): Promise<void> {
	await env.DB.prepare(`
		DELETE FROM connections
		WHERE scope_type = 'artifact' AND scope_id = ? AND id = ? AND kind = 'platform'
	`)
		.bind(artifactId, connectionId)
		.run();
}

export async function listConnections(
	env: Env,
	artifactId: string
): Promise<Array<ConnectionConfig & { scope: ConnectionScope }>> {
	const rows = await env.DB.prepare(`
		SELECT id, name, provider, config, preferred_mode, created_at, updated_at
		FROM connections
		WHERE scope_type = 'artifact' AND scope_id = ? AND kind = 'platform'
		ORDER BY created_at DESC
	`)
		.bind(artifactId)
		.all<{
			id: string;
			name: string;
			provider: string;
			config: string;
			preferred_mode: ExecutionMode;
			created_at: string;
			updated_at: string;
		}>();

	const local = rows.results.map((row) => ({
		id: row.id,
		name: row.name,
		provider: row.provider,
		preferredMode: row.preferred_mode,
		config: JSON.parse(row.config),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		scope: 'artifact' as ConnectionScope,
	}));

	const workspaceId = await getArtifactWorkspaceId(env, artifactId);
	if (!workspaceId) return local;

	const wrows = await env.DB.prepare(`
		SELECT id, name, provider, config, preferred_mode, created_at, updated_at
		FROM connections
		WHERE scope_type = 'workspace' AND scope_id = ? AND kind = 'platform'
		ORDER BY created_at DESC
	`)
		.bind(workspaceId)
		.all<{
			id: string;
			name: string;
			provider: string;
			config: string;
			preferred_mode: ExecutionMode;
			created_at: string;
			updated_at: string;
		}>();

	const shared = wrows.results.map((row) => ({
		id: row.id,
		name: row.name,
		provider: row.provider,
		preferredMode: row.preferred_mode,
		config: JSON.parse(row.config),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		scope: 'workspace' as ConnectionScope,
	}));

	return [...local, ...shared];
}
