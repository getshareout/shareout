/**
 * The custom-domain step as shipped: provisioning falls back to it when no hook is
 * registered (hooks.ts stays the override seam). It is idempotent, and reports `pending`
 * with a next step when this instance cannot act on it yet.
 */
import { DomainError, provisionWorkspaceDomain } from '../../workspaces/domains';
import type { ProvisionHook, ProvisionHookName } from './hooks';


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
  custom_domain: customDomain,
};
