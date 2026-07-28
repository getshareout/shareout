/**
 * Credential shaping and safe summarization for workspace connectors.
 * Secret values are never returned to clients — only configured secret key names.
 */

// Non-secret identifiers we can safely surface from a decrypted credential blob.
const SAFE_CRED_KEYS = new Set([
  'client_email', 'project_id', 'project', 'team_id', 'team_name', 'bot_user_id',
  'app_id', 'account', 'user', 'username', 'public_key_fingerprint', 'header_name',
  'base_url', 'baseurl', 'host', 'port', 'database', 'client_id', 'expires_at',
  'scope', 'warehouse', 'schema', 'role',
]);

// Keys whose VALUES are secret — we report only that they're configured, never the value.
const SECRET_CRED_KEYS = new Set([
  'private_key', 'access_token', 'refresh_token', 'client_secret', 'api_key',
  'apikey', 'password', 'token', 'secret',
]);

/**
 * Walk a (possibly nested) credential object and split it into safe identifiers
 * vs. the names of configured secrets. Unknown keys are dropped, never leaked.
 */
export function summarizeCredentials(cred: Record<string, unknown>): {
  identifiers: Record<string, unknown>;
  secretsConfigured: string[];
} {
  const identifiers: Record<string, unknown> = {};
  const secretsConfigured = new Set<string>();
  const walk = (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj || {})) {
      const lk = k.toLowerCase();
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v as Record<string, unknown>);
      } else if (SECRET_CRED_KEYS.has(lk)) {
        if (v) secretsConfigured.add(k);
      } else if (SAFE_CRED_KEYS.has(lk)) {
        if (v !== '' && v != null) identifiers[k] = v;
      }
    }
  };
  walk(cred);
  return { identifiers, secretsConfigured: [...secretsConfigured] };
}

/**
 * Map a connect-form credential payload to the decrypted-credentials shape a
 * provider's verifyConnection expects. Mirrors createPlatformConnection.
 */
export function buildProbeCredentials(creds: { type: string; data?: Record<string, unknown> } | undefined) {
  const type = creds?.type;
  const data = creds?.data || {};
  if (type === 'service_account') {
    return { access_token: '', extra: { service_account: data } };
  }
  if (type === 'authorized_user') {
    return {
      access_token: '',
      extra: {
        authorized_user: { client_id: data.client_id, client_secret: data.client_secret, refresh_token: data.refresh_token },
        ...(data.developer_token ? { developer_token: data.developer_token } : {}),
      },
    };
  }
  if (type === 'key_pair') {
    return { access_token: '', extra: { ...data } };
  }
  return { access_token: (data.access_token as string) || (data.api_key as string) || '' };
}
