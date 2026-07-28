import type { EmailConfig } from '../../scheduling/email';
import { sendArtifactEmail, checkEmailRateLimit, incrementEmailCount } from '../../scheduling/email';
import { getTemplateForArtifact } from '../../scheduling/templates';
import type { Destination } from '../types';

export const emailDestination: Destination<EmailConfig> = {
  kind: 'email',

  async validate(env, ctx, config) {
    if (!config.recipients || config.recipients.length === 0) return 'Email recipients required';
    if (config.recipients.length > 10) return 'Maximum 10 recipients per email';
    for (const email of config.recipients) {
      if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return `Invalid email: ${email}`;
    }
    if (config.template_id) {
      const template = await getTemplateForArtifact(env, config.template_id, ctx.artifactId);
      if (!template) return `Template not found: ${config.template_id}`;
    }
    return null;
  },

  async deliver(env, ctx, config) {
    const rateLimit = await checkEmailRateLimit(env, ctx.createdBy, ctx.artifactId);
    if (!rateLimit.allowed) return { success: false, error: 'Email rate limit exceeded' };

    const result = await sendArtifactEmail(env, ctx.artifactId, config);
    if (result.success) await incrementEmailCount(env, ctx.createdBy, ctx.artifactId);
    return result;
  },
};
