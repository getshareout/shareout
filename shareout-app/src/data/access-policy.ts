// Row-level access policy: resolves a server-verified viewer to the set of
// values they may see for one field. Pure logic — SQL enforcement lives in the
// data backends (e.g. tables.ts) which consume the normalized ViewerScope.

export type ScopeValue = string | number;

export interface AccessRule {
  match: { email?: string; domain?: string };
  values: ScopeValue[];
}

export interface AccessPolicy {
  version: number;
  field: string;
  default: 'deny' | 'allow';
  rules: AccessRule[];
}

// Normalized result of resolving a policy against a viewer.
// `values: []` means deny-all (no row matches). A `null` scope means no
// filtering (no policy, owner bypass, or default-allow with no match).
export interface ViewerScope {
  field: string;
  values: ScopeValue[];
}

export interface Viewer {
  email: string | null;
  isOwner: boolean;
}

function domainOf(email: string): string {
  return email.slice(email.indexOf('@') + 1).toLowerCase();
}

// Validate an untrusted policy object (publish/PATCH input). Returns an error
// message, or null if valid.
export function validateAccessPolicy(input: unknown): string | null {
  if (input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    return 'access_policy must be an object';
  }
  const p = input as Record<string, unknown>;
  if (p.version !== 1) return 'access_policy.version must be 1';
  if (typeof p.field !== 'string' || !p.field.trim()) {
    return 'access_policy.field must be a non-empty string';
  }
  if (p.default !== 'deny' && p.default !== 'allow') {
    return 'access_policy.default must be "deny" or "allow"';
  }
  if (!Array.isArray(p.rules)) return 'access_policy.rules must be an array';
  for (const [i, raw] of (p.rules as unknown[]).entries()) {
    if (typeof raw !== 'object' || raw === null) return `access_policy.rules[${i}] must be an object`;
    const rule = raw as Record<string, unknown>;
    const match = rule.match as Record<string, unknown> | undefined;
    if (!match || typeof match !== 'object') return `access_policy.rules[${i}].match is required`;
    const hasEmail = typeof match.email === 'string';
    const hasDomain = typeof match.domain === 'string';
    if (!hasEmail && !hasDomain) return `access_policy.rules[${i}].match needs an "email" or "domain"`;
    if (!Array.isArray(rule.values) || rule.values.length === 0) {
      return `access_policy.rules[${i}].values must be a non-empty array`;
    }
    for (const v of rule.values) {
      if (typeof v !== 'string' && typeof v !== 'number') {
        return `access_policy.rules[${i}].values must contain strings or numbers`;
      }
    }
  }
  return null;
}

// Safe parse for the stored policy column. Returns null on absent/invalid JSON.
export function parseAccessPolicy(json: string | null | undefined): AccessPolicy | null {
  if (!json) return null;
  try {
    const obj = JSON.parse(json);
    if (validateAccessPolicy(obj) !== null) return null;
    return obj as AccessPolicy;
  } catch {
    return null;
  }
}

// Resolve the policy against the viewer into a normalized scope.
// Returns null when no filtering should apply (no policy, owner bypass, or
// default-allow with no matching rule). Returns { field, values: [] } to
// deny all rows (default-deny with no match, including anonymous viewers).
export function resolveViewerScope(
  policy: AccessPolicy | null,
  viewer: Viewer
): ViewerScope | null {
  if (!policy) return null;
  if (viewer.isOwner) return null;

  const email = viewer.email?.toLowerCase() ?? null;
  const domain = email ? domainOf(email) : null;

  const allowed = new Set<ScopeValue>();
  let matched = false;
  for (const rule of policy.rules) {
    const ruleEmail = rule.match.email?.toLowerCase();
    const ruleDomain = rule.match.domain?.toLowerCase();
    const hit =
      (ruleEmail !== undefined && email !== null && ruleEmail === email) ||
      (ruleDomain !== undefined && domain !== null && ruleDomain === domain);
    if (hit) {
      matched = true;
      for (const v of rule.values) allowed.add(v);
    }
  }

  if (matched) return { field: policy.field, values: [...allowed] };
  if (policy.default === 'allow') return null;
  return { field: policy.field, values: [] };
}

// SQL list fragment for the `:viewer_scope` placeholder in Data Platform queries
// (e.g. `WHERE company_id IN (:viewer_scope)`). Values come from the author's
// policy (trusted), not the viewer; strings are still escaped defensively.
// An empty scope yields `NULL`, so `IN (NULL)` matches nothing (deny all).
export function viewerScopeSqlList(scope: ViewerScope): string {
  if (scope.values.length === 0) return 'NULL';
  return scope.values
    .map((v) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`))
    .join(', ');
}

// Stable cache-key segment for a viewer scope, so per-viewer filtered results are
// never served across viewers from a shared cache. null/undefined => 'all'.
export function viewerScopeCacheKey(scope: ViewerScope | null | undefined): string {
  if (!scope) return 'all';
  return `${scope.field}:${[...scope.values].sort().join(',')}`;
}
