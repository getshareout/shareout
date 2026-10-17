/**
 * The provisioning spec: what an operator hands `POST /v1/admin/workspaces/provision`
 * (or `scripts/provision-workspace.mjs`) to stand up one customer workspace.
 *
 * Everything is checked here, before a single row is written, so a bad spec fails
 * whole with one clear error instead of leaving half a workspace behind. Steps that can
 * only fail at run time (fetching a logo URL, a connector the provider refuses) are
 * reported per step by run.ts.
 */
import type { ApiErrorFields } from '../../http/api-error';
import { SLUG_REGEX, isReservedWorkspaceSlug } from '../../workspaces/slug';
import { isValidEmail } from '../../workspaces/parse-emails';
import { DOMAIN_REGEX, PUBLIC_EMAIL_DOMAINS, normalizeDomain } from '../../workspaces/access-policy';
import { HEX_COLOR_REGEX, logoProblem } from '../../workspaces/branding';
import { isKnownFeature } from '../../features/registry';
import { isLocale, type Locale } from '../../i18n/locale';
import { validateName } from '../../router/api/workspace-connections/shared';
import type { WorkspaceConnectionInput } from '../../router/api/workspace-connections/crud';

export const SLUG_MIN = 2;
export const SLUG_MAX = 63;
export const MAX_ADMINS = 20;
export const MAX_FOLDERS = 50;
export const MAX_CONNECTORS = 20;
const HOSTNAME_REGEX = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export interface ProvisionLogo {
  url?: string;
  /** Raw bytes as base64 (the CLI fills this from `logo_file`). */
  data_base64?: string;
  content_type?: string;
}

export interface ProvisionSpec {
  name: string;
  slug: string;
  locale: Locale;
  description: string | null;
  /** Owner of a new workspace. Defaults to the first admin. Ignored on an existing one. */
  owner_email: string;
  /** Everyone who should be an admin (the owner included). */
  admins: string[];
  /** What to do when the slug exists under a different name: `update` adopts it. */
  if_exists: 'match' | 'update' | 'fail';
  subdomain: boolean | null;
  branding: { accent_color?: string | null; hide_footer?: boolean; logo?: ProvisionLogo } | null;
  policy: {
    allowed_domains?: string[];
    allowed_emails?: string[];
    external_sharing?: boolean;
    guest_comments?: boolean;
    knowledge?: boolean;
    features?: Record<string, boolean>;
  };
  folders: string[];
  connectors: WorkspaceConnectionInput[];
  resend_invites: boolean;
  /** Hooks for features that ship separately; see hooks.ts. */
  templates: string | null;
  custom_domain: string | null;
}

type Invalid = Pick<ApiErrorFields, 'code' | 'message'> & { param?: string; hint?: string };
export type SpecResult = { ok: true; spec: ProvisionSpec } | { ok: false; error: Invalid };

const fail = (code: string, message: string, param?: string, hint?: string): SpecResult => ({
  ok: false,
  error: { code, message, ...(param ? { param } : {}), ...(hint ? { hint } : {}) },
});

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const optBool = (v: unknown): v is boolean | undefined => v === undefined || typeof v === 'boolean';

function stringList(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  if (typeof v === 'string') return v.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return null;
  return (v as string[]).map((s) => s.trim()).filter(Boolean);
}

/** Bytes a base64 string decodes to, without decoding it. */
export function base64Bytes(b64: string): number {
  const clean = b64.replace(/\s+/g, '');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

function parseLogo(raw: unknown): { logo?: ProvisionLogo; error?: SpecResult } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === 'string') raw = { url: raw };
  if (!isObject(raw)) return { error: fail('INVALID_LOGO', 'branding.logo must be a URL or { url } / { data_base64, content_type }', 'branding.logo') };
  const { url, data_base64, content_type } = raw;
  if (url !== undefined) {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
      return { error: fail('INVALID_LOGO', 'branding.logo.url must be an https:// URL', 'branding.logo.url') };
    }
    return { logo: { url } };
  }
  if (typeof data_base64 !== 'string' || typeof content_type !== 'string') {
    return { error: fail('INVALID_LOGO', 'branding.logo needs url, or data_base64 with content_type', 'branding.logo') };
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(data_base64)) {
    return { error: fail('INVALID_LOGO', 'branding.logo.data_base64 is not base64', 'branding.logo.data_base64') };
  }
  const problem = logoProblem(content_type.toLowerCase(), base64Bytes(data_base64));
  if (problem) return { error: fail(`LOGO_${problem.code}`, problem.error, 'branding.logo') };
  return { logo: { data_base64, content_type: content_type.toLowerCase() } };
}

function parseConnectors(raw: unknown): { connectors: WorkspaceConnectionInput[]; error?: SpecResult } {
  if (raw === undefined || raw === null) return { connectors: [] };
  if (!Array.isArray(raw)) return { connectors: [], error: fail('VALIDATION_ERROR', 'connectors must be an array', 'connectors') };
  if (raw.length > MAX_CONNECTORS) {
    return { connectors: [], error: fail('VALIDATION_ERROR', `At most ${MAX_CONNECTORS} connectors`, 'connectors') };
  }
  const seen = new Set<string>();
  const out: WorkspaceConnectionInput[] = [];
  for (const [i, c] of raw.entries()) {
    const param = `connectors[${i}]`;
    if (!isObject(c)) return { connectors: [], error: fail('VALIDATION_ERROR', `${param} must be an object`, param) };
    const nameError = validateName(typeof c.name === 'string' ? c.name : '');
    if (nameError) return { connectors: [], error: fail('VALIDATION_ERROR', `${param}.name: ${nameError}`, `${param}.name`) };
    if (seen.has(c.name as string)) {
      return { connectors: [], error: fail('VALIDATION_ERROR', `${param}.name is a duplicate`, `${param}.name`) };
    }
    seen.add(c.name as string);
    if (c.kind === 'platform' ? typeof c.provider !== 'string' : typeof c.type !== 'string') {
      return {
        connectors: [],
        error: fail('VALIDATION_ERROR', `${param} needs type (or kind: "platform" with provider)`, param),
      };
    }
    if (c.credentials !== undefined && !isObject(c.credentials)) {
      return { connectors: [], error: fail('VALIDATION_ERROR', `${param}.credentials must be an object`, `${param}.credentials`) };
    }
    out.push(c as unknown as WorkspaceConnectionInput);
  }
  return { connectors: out };
}

export function parseProvisionSpec(input: unknown): SpecResult {
  if (!isObject(input)) return fail('INVALID_JSON', 'Body must be a JSON object');

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return fail('VALIDATION_ERROR', 'name is required', 'name');
  if (name.length > 100) return fail('VALIDATION_ERROR', 'name is too long (max 100)', 'name');

  if (typeof input.slug !== 'string' || !input.slug.trim()) {
    return fail('VALIDATION_ERROR', 'slug is required — it is also the subdomain, so it is never guessed', 'slug');
  }
  const slug = input.slug.trim();
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX || !SLUG_REGEX.test(slug)) {
    return fail(
      'INVALID_SLUG',
      `Invalid slug. Use ${SLUG_MIN}–${SLUG_MAX} lowercase letters, numbers and hyphens, starting and ending with a letter or number.`,
      'slug',
    );
  }
  if (isReservedWorkspaceSlug(slug)) {
    return fail('SLUG_RESERVED', `"${slug}" is reserved on this instance`, 'slug', 'Pick another slug, e.g. the customer name plus a suffix.');
  }

  const locale = input.locale ?? 'en';
  if (!isLocale(locale)) return fail('VALIDATION_ERROR', "locale must be 'en' or 'es'", 'locale');

  const admins = stringList(input.admins);
  if (!admins) return fail('VALIDATION_ERROR', 'admins must be a list of emails', 'admins');
  const ownerRaw = typeof input.owner_email === 'string' ? input.owner_email.trim().toLowerCase() : '';
  const all = [...new Set([...(ownerRaw ? [ownerRaw] : []), ...admins.map((e) => e.toLowerCase())])];
  if (!all.length) return fail('VALIDATION_ERROR', 'admins needs at least one email', 'admins');
  if (all.length > MAX_ADMINS) return fail('VALIDATION_ERROR', `At most ${MAX_ADMINS} admins`, 'admins');
  const badEmail = all.find((e) => !isValidEmail(e));
  if (badEmail) return fail('INVALID_EMAIL', `Invalid email: ${badEmail}`, 'admins');

  const ifExists = input.if_exists ?? 'match';
  if (ifExists !== 'match' && ifExists !== 'update' && ifExists !== 'fail') {
    return fail('VALIDATION_ERROR', "if_exists must be 'match', 'update' or 'fail'", 'if_exists');
  }
  if (input.subdomain !== undefined && input.subdomain !== null && typeof input.subdomain !== 'boolean') {
    return fail('VALIDATION_ERROR', 'subdomain must be true or false', 'subdomain');
  }

  let branding: ProvisionSpec['branding'] = null;
  if (input.branding !== undefined && input.branding !== null) {
    const b = input.branding;
    if (!isObject(b)) return fail('VALIDATION_ERROR', 'branding must be an object', 'branding');
    branding = {};
    if (b.accent_color !== undefined) {
      if (b.accent_color === null || b.accent_color === '') branding.accent_color = null;
      else if (typeof b.accent_color === 'string' && HEX_COLOR_REGEX.test(b.accent_color)) branding.accent_color = b.accent_color.toLowerCase();
      else return fail('INVALID_COLOR', 'branding.accent_color must be a #RRGGBB hex value', 'branding.accent_color');
    }
    if (!optBool(b.hide_footer)) return fail('VALIDATION_ERROR', 'branding.hide_footer must be true or false', 'branding.hide_footer');
    if (b.hide_footer !== undefined) branding.hide_footer = b.hide_footer;
    const logo = parseLogo(b.logo);
    if (logo.error) return logo.error;
    if (logo.logo) branding.logo = logo.logo;
  }

  const p = input.policy ?? {};
  if (!isObject(p)) return fail('VALIDATION_ERROR', 'policy must be an object', 'policy');
  const policy: ProvisionSpec['policy'] = {};
  if (p.allowed_domains !== undefined) {
    const list = stringList(p.allowed_domains);
    if (!list) return fail('VALIDATION_ERROR', 'policy.allowed_domains must be a list', 'policy.allowed_domains');
    const domains = [...new Set(list.map(normalizeDomain))];
    const bad = domains.find((d) => !DOMAIN_REGEX.test(d));
    if (bad) return fail('INVALID_DOMAIN', `Invalid domain: ${bad}`, 'policy.allowed_domains');
    const pub = domains.find((d) => PUBLIC_EMAIL_DOMAINS.includes(d));
    if (pub) {
      return fail('PUBLIC_EMAIL_DOMAIN', `${pub} is a public email provider — allowing it would let anyone with an address there join`,
        'policy.allowed_domains', 'Allow the company domain, or list individual addresses in policy.allowed_emails.');
    }
    policy.allowed_domains = domains;
  }
  if (p.allowed_emails !== undefined) {
    const list = stringList(p.allowed_emails);
    if (!list) return fail('VALIDATION_ERROR', 'policy.allowed_emails must be a list', 'policy.allowed_emails');
    const emails = [...new Set(list.map((e) => e.toLowerCase()))];
    const bad = emails.find((e) => !isValidEmail(e));
    if (bad) return fail('INVALID_EMAIL', `Invalid email: ${bad}`, 'policy.allowed_emails');
    policy.allowed_emails = emails;
  }
  for (const k of ['external_sharing', 'guest_comments', 'knowledge'] as const) {
    if (!optBool(p[k])) return fail('VALIDATION_ERROR', `policy.${k} must be true or false`, `policy.${k}`);
    if (p[k] !== undefined) policy[k] = p[k] as boolean;
  }
  if (p.features !== undefined) {
    if (!isObject(p.features)) return fail('VALIDATION_ERROR', 'policy.features must be an object of flag → true/false', 'policy.features');
    for (const [k, v] of Object.entries(p.features)) {
      if (!isKnownFeature(k)) return fail('INVALID_FEATURE', `Unknown feature flag: ${k}`, 'policy.features', 'GET /v1/admin/features lists them.');
      if (typeof v !== 'boolean') return fail('VALIDATION_ERROR', `policy.features.${k} must be true or false`, 'policy.features');
    }
    policy.features = p.features as Record<string, boolean>;
  }

  // An allowlist that shuts out the people being invited would leave nobody to sign in.
  if (policy.allowed_domains?.length || policy.allowed_emails?.length) {
    const outside = all.find((e) => !policy.allowed_emails?.includes(e) && !policy.allowed_domains?.includes(e.split('@')[1]));
    if (outside) {
      return fail('ADMIN_OUTSIDE_POLICY', `${outside} is outside policy.allowed_domains / allowed_emails, so the invite would be refused`,
        'admins', 'Add that domain or address to the policy, or invite someone inside it.');
    }
  }

  const folders = stringList(input.folders);
  if (!folders) return fail('VALIDATION_ERROR', 'folders must be a list of names', 'folders');
  if (folders.length > MAX_FOLDERS) return fail('VALIDATION_ERROR', `At most ${MAX_FOLDERS} folders`, 'folders');
  const longFolder = folders.find((f) => f.length > 100);
  if (longFolder) return fail('VALIDATION_ERROR', `Folder name too long: ${longFolder.slice(0, 40)}…`, 'folders');

  const conn = parseConnectors(input.connectors);
  if (conn.error) return conn.error;

  if (!optBool(input.resend_invites)) return fail('VALIDATION_ERROR', 'resend_invites must be true or false', 'resend_invites');

  const templates = input.templates ?? null;
  if (templates !== null && (typeof templates !== 'string' || !templates.trim())) {
    return fail('VALIDATION_ERROR', 'templates must be the name of a template set', 'templates');
  }
  const customDomain = typeof input.custom_domain === 'string' ? input.custom_domain.trim().toLowerCase() : input.custom_domain ?? null;
  if (customDomain !== null && (typeof customDomain !== 'string' || !HOSTNAME_REGEX.test(customDomain))) {
    return fail('INVALID_DOMAIN', 'custom_domain must be a hostname like reports.example.com', 'custom_domain');
  }

  return {
    ok: true,
    spec: {
      name,
      slug,
      locale,
      description: typeof input.description === 'string' && input.description.trim() ? input.description.trim() : null,
      owner_email: ownerRaw || all[0],
      admins: all,
      if_exists: ifExists,
      subdomain: typeof input.subdomain === 'boolean' ? input.subdomain : null,
      branding,
      policy,
      folders: [...new Set(folders)],
      connectors: conn.connectors,
      resend_invites: input.resend_invites === true,
      templates: templates as string | null,
      custom_domain: customDomain as string | null,
    },
  };
}
