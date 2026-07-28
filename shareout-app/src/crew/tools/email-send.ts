import { sendArtifactEmail, checkEmailRateLimit, incrementEmailCount } from '../../scheduling/email';
import { getArtifactOwner } from '../../data/email/handler';
import type { CrewTool } from '../types';

export const emailSendTool: CrewTool = {
  name: 'email_send',
  mode: 'write',
  defaultApproval: 'whenPublic',
  description:
    "Send an email on the owner's behalf. Provide a subject and an HTML or text body. Omit \"to\" to email the app owner; otherwise pass recipient address(es).",
  input_schema: {
    type: 'object',
    properties: {
      to: { type: 'array', items: { type: 'string' }, description: 'Recipient email address(es). Omit to email the app owner.' },
      subject: { type: 'string', description: 'Email subject.' },
      html: { type: 'string', description: 'HTML body.' },
      text: { type: 'string', description: 'Plain-text body.' },
    },
    required: ['subject'],
  },
  async execute(ctx, input) {
    const env = ctx.data.env;
    const artifactId = ctx.data.artifactId;
    const owner = await getArtifactOwner(ctx.data);

    let recipients: string[] = Array.isArray(input.to)
      ? (input.to as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    if (!recipients.length) {
      if (!owner?.ownerEmail) return { error: 'No recipients given and the owner has no email on file.' };
      recipients = [owner.ownerEmail];
    }

    const subject = typeof input.subject === 'string' ? input.subject : '';
    const html = typeof input.html === 'string' ? input.html : undefined;
    const text = typeof input.text === 'string' ? input.text : undefined;
    if (!subject) return { error: 'Missing required field "subject".' };
    if (!html && !text) return { error: 'Provide an "html" or "text" body.' };

    if (owner) {
      const rl = await checkEmailRateLimit(env, owner.ownerId, artifactId);
      if (!rl.allowed) return { error: 'Email rate limit reached for today.' };
    }

    const result = await sendArtifactEmail(env, artifactId, {
      recipients,
      subject,
      html,
      body: text,
      includeArtifactLink: false,
    });
    if (!result.success) return { error: result.error || 'email send failed' };

    if (owner) await incrementEmailCount(env, owner.ownerId, artifactId);
    return { sent: true, to: recipients, messageId: result.messageId };
  },
};
