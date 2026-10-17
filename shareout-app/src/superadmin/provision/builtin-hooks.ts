/**
 * The template and custom-domain steps as shipped: provisioning falls back to these when
 * no hook is registered (hooks.ts stays the override seam). Both are idempotent, and each
 * reports `pending` with a next step when this instance cannot act on it yet.
 */
import { installTemplateSet } from '../../templates';
import { DomainError, provisionWorkspaceDomain } from '../../workspaces/domains';
import type { ProvisionHook, ProvisionHookName } from './hooks';

const templates: ProvisionHook = async ({ env, workspace, actor }, tag) => {
  const res = await installTemplateSet(env, { id: actor.id, email: actor.email, username: null }, {
    workspaceId: workspace.id, tag, skipInstalled: true,
  });
  if (res.failed.length) {
    throw new Error(`Template set "${tag}": ${res.failed.map((f) => `${f.template_id} ${f.code}`).join(', ')}`);
  }
  const detail = { installed: res.installed.map((r) => r.template_id), already_installed: res.skipped };
  if (res.installed.length) return { status: 'created', detail };
  if (res.skipped.length) return { status: 'unchanged', detail };
  return {
    status: 'pending', detail,
    next_step: `No instance-library template is tagged "${tag}". Publish one with that tag, then re-run this spec.`,
  };
};

const customDomain: ProvisionHook = async ({ env, workspace, actor }, hostname) => {
  try {
    const d = await provisionWorkspaceDomain(env, { workspaceId: workspace.id, hostname, actorId: actor.id, primary: true });
    const detail = { id: d.id, status: d.status, dns: d.dns };
    if (d.status === 'active') return { status: 'unchanged', detail };
    return { status: 'pending', detail, next_step: d.instructions.join(' ') };
  } catch (err) {
    if (err instanceof DomainError && err.code === 'CUSTOM_DOMAINS_DISABLED') {
      return { status: 'pending', next_step: `Enable custom domains on this instance, then re-run this spec to attach ${hostname}.` };
    }
    throw err;
  }
};

export const BUILTIN_PROVISION_HOOKS: Record<ProvisionHookName, ProvisionHook> = {
  templates,
  custom_domain: customDomain,
};
