// A fake Microsoft identity platform (Entra ID v2.0) shaped like the real one:
// - discovery for `common` / `organizations` publishes the templated issuer
//   `https://login.microsoftonline.com/{tenantid}/v2.0`; a tenant GUID publishes its own;
// - the keys document names the issuer each key may sign for (the consumer-tenant key is
//   pinned to the personal-account issuer);
// - ID tokens carry `ver`, `tid`, `oid`, `preferred_username` and, as Microsoft sends it,
//   `xms_edov` as the string "1".
// Keys are generated per run; nothing here talks to Microsoft.

export const ENTRA = 'https://login.microsoftonline.com';
export const TENANT_ID = '6a1f3c2e-0b4d-4e8f-9a7c-2d5e8f1b3c4a';
export const OTHER_TENANT_ID = '0c9e7d5b-3a1f-4e2d-8b6c-9f0a1b2c3d4e';
export const CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';
export const TEMPLATED_ISSUER = `${ENTRA}/{tenantid}/v2.0`;

const ORG_KID = 'org-key-1';
const MSA_KID = 'msa-key-1';

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

async function rsaKey(): Promise<{ pair: CryptoKeyPair; jwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  return { pair, jwk: await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey };
}

async function sign(pair: CryptoKeyPair, kid: string, claims: Record<string, unknown>): Promise<string> {
  const head = b64urlJson({ typ: 'JWT', alg: 'RS256', kid });
  const body = b64urlJson(claims);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

/** Corrupt a token's signature while keeping it well-formed. */
export function breakSignature(token: string): string {
  const [h, p] = token.split('.');
  return `${h}.${p}.${b64url(new Uint8Array(256))}`;
}

/** The default claims of an Entra v2.0 ID token for a work account in TENANT_ID. */
export function entraClaims(clientId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  const tid = (over.tid as string | undefined) ?? TENANT_ID;
  return {
    ver: '2.0',
    iss: `${ENTRA}/${tid}/v2.0`,
    sub: 'AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ',
    aud: clientId,
    exp: now + 3600,
    iat: now,
    nbf: now,
    nonce: 'n1',
    tid,
    oid: '00000000-0000-0000-66f3-3332eca7ea81',
    name: 'Ana Perez',
    preferred_username: 'ana@acme.example',
    email: 'Ana@Acme.example',
    xms_edov: '1',
    ...over,
  };
}

export interface EntraFixture {
  /** Sign with the work/school key (issuer `{tenantid}` in `common`, pinned in a tenant). */
  signOrg(claims: Record<string, unknown>, kid?: string): Promise<string>;
  /** Sign with the personal-account key (issuer pinned to the consumer tenant). */
  signConsumer(claims: Record<string, unknown>): Promise<string>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  tokenRequests: Request[];
  tokenResponse: () => Promise<Response>;
}

function discovery(tenant: string) {
  const authority = `${ENTRA}/${tenant}`;
  return {
    token_endpoint: `${authority}/oauth2/v2.0/token`,
    token_endpoint_auth_methods_supported: ['client_secret_post', 'private_key_jwt', 'client_secret_basic', 'self_signed_tls_client_auth'],
    jwks_uri: `${authority}/discovery/v2.0/keys`,
    response_modes_supported: ['query', 'fragment', 'form_post'],
    subject_types_supported: ['pairwise'],
    id_token_signing_alg_values_supported: ['RS256'],
    response_types_supported: ['code', 'id_token', 'code id_token', 'id_token token'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    issuer: tenant === 'common' || tenant === 'organizations' ? TEMPLATED_ISSUER : `${ENTRA}/${tenant === 'consumers' ? CONSUMER_TENANT_ID : tenant}/v2.0`,
    request_uri_parameter_supported: false,
    userinfo_endpoint: 'https://graph.microsoft.com/oidc/userinfo',
    authorization_endpoint: `${authority}/oauth2/v2.0/authorize`,
    end_session_endpoint: `${authority}/oauth2/v2.0/logout`,
    claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'auth_time', 'acr', 'nonce', 'preferred_username', 'name', 'tid', 'ver', 'at_hash', 'c_hash', 'email'],
    tenant_region_scope: null,
    cloud_instance_name: 'microsoftonline.com',
  };
}

export async function createEntraFixture(): Promise<EntraFixture> {
  const org = await rsaKey();
  const msa = await rsaKey();
  const orgJwk = (issuer: string) => ({ ...org.jwk, kid: ORG_KID, x5t: ORG_KID, use: 'sig', x5c: ['MIIC'], cloud_instance_name: 'microsoftonline.com', issuer });
  const msaJwk = { ...msa.jwk, kid: MSA_KID, x5t: MSA_KID, use: 'sig', x5c: ['MIIC'], cloud_instance_name: 'microsoftonline.com', issuer: `${ENTRA}/${CONSUMER_TENANT_ID}/v2.0` };

  const fixture: EntraFixture = {
    signOrg: (claims, kid = ORG_KID) => sign(org.pair, kid, claims),
    signConsumer: (claims) => sign(msa.pair, MSA_KID, claims),
    tokenRequests: [],
    tokenResponse: async () => new Response('no token configured', { status: 500 }),
    fetch(input, init) {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.origin !== ENTRA) return Promise.resolve(new Response('not found', { status: 404 }));
      const [, tenant, ...rest] = url.pathname.split('/');
      const path = `/${rest.join('/')}`;
      if (path === '/v2.0/.well-known/openid-configuration') return Promise.resolve(Response.json(discovery(tenant)));
      if (path === '/discovery/v2.0/keys') {
        const keys = tenant === 'common'
          ? [orgJwk(TEMPLATED_ISSUER), msaJwk]
          : tenant === 'organizations'
            ? [orgJwk(TEMPLATED_ISSUER)]
            : tenant === 'consumers'
              ? [msaJwk]
              : [orgJwk(`${ENTRA}/${tenant}/v2.0`)];
        return Promise.resolve(Response.json({ keys }));
      }
      if (path === '/oauth2/v2.0/token' && init?.method === 'POST') {
        fixture.tokenRequests.push(new Request(url, init));
        return fixture.tokenResponse();
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    },
  };
  return fixture;
}
