import { getDestination } from '../../delivery/registry';
import type { CrewTool } from '../types';
import { resolveDeliverySource } from './source-provenance';

export const notifySendTool: CrewTool = {
  name: 'notify_send',
  mode: 'write',
  defaultApproval: 'always',
  description:
    'Deliver this app right now to a destination — a Slack channel or DM, email, Discord, or webhook — via the shared delivery layer. Pass `message` to send your own text (e.g. a summary you wrote); for Slack set config.mode to "both" to attach a screenshot + link alongside the message. One-shot; for recurring delivery use scheduled_job_create. High-impact — always requires owner approval.',
  input_schema: {
    type: 'object',
    properties: {
      destination: {
        type: 'string',
        enum: ['slack', 'email', 'discord', 'webhook'],
        description: 'Where to deliver.',
      },
      message: {
        type: 'string',
        description: 'Optional message text to deliver (Slack/Discord). For Slack, use mrkdwn (single *asterisks*).',
      },
      source: {
        type: 'object',
        description:
          'Optional data provenance for this delivery (appended as a small attribution footer). Pass asOf (date the data reflects). Tables/columns/filters are resolved from the query_snapshot job when omitted. Do NOT pass json_get/table_query tool calls.',
        properties: {
          connection: { type: 'string' },
          label: { type: 'string' },
          query: { type: 'string' },
          asOf: { type: 'string' },
          tables: { type: 'array', items: { type: 'string' } },
          columns: { type: 'array', items: { type: 'string' } },
          filters: { type: 'array', items: { type: 'string' } },
        },
      },
      config: {
        type: 'object',
        description: 'Destination-specific config, same shape as a scheduled job config (e.g. Slack { connection, channelId | (targetType:"dm", slackUserId), mode }).',
      },
    },
    required: ['destination', 'config'],
  },
  async execute(ctx, input) {
    const kind = typeof input.destination === 'string' ? input.destination : '';
    const config = input.config;
    if (!kind || !config || typeof config !== 'object') {
      return { error: 'Provide "destination" and "config".' };
    }
    // Surface a top-level `message` as the destination's customMessage so the model
    // can deliver its own narrative without knowing each destination's field name.
    if (typeof input.message === 'string' && input.message) {
      const c = config as Record<string, unknown>;
      if (c.customMessage === undefined) c.customMessage = input.message;
    }
    // Append a provenance footer so recipients can trace where the data came from.
    const source = await resolveDeliverySource(ctx.data.env, ctx.data.artifactId, input.source);
    const footer = buildSourceFooter(source);
    if (footer) {
      const c = config as Record<string, unknown>;
      const existing = typeof c.customMessage === 'string' ? c.customMessage : '';
      c.customMessage = existing ? `${existing}\n\n${footer}` : footer;
    }

    const destination = getDestination(kind);
    if (!destination) return { error: `Unknown destination: ${kind}` };

    const dctx = {
      artifactId: ctx.data.artifactId,
      createdBy: ctx.principal.ownerId,
      triggeredVia: 'crew' as const,
    };

    const validationError = await destination.validate(ctx.data.env, dctx, config);
    if (validationError) return { error: validationError };

    const result = await destination.deliver(ctx.data.env, dctx, config);
    return result.success ? { delivered: true } : { error: result.error };
  },
};

function strList(v: unknown, max = 12): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter(Boolean).slice(0, max);
  }
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

/** Format an optional `source` object as a Slack mrkdwn attribution footer. */
export function buildSourceFooter(source: unknown): string {
  if (!source || typeof source !== 'object') return '';
  const s = source as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const origin = str(s.label) || str(s.connection);
  const asOf = str(s.asOf);
  const query = str(s.query);
  const tables = strList(s.tables, 8);
  const columns = strList(s.columns, 10);
  const filters = strList(s.filters, 6);

  const parts: string[] = [];
  if (origin) parts.push(`Source: ${origin}`);
  if (asOf) parts.push(`as of ${asOf}`);

  const lines: string[] = [];
  if (parts.length) lines.push(`_${parts.join(' · ')}_`);
  if (tables.length) {
    lines.push(`_Tables:_ ${tables.map((t) => `\`${t}\``).join(', ')}`);
  }
  if (columns.length) {
    const clipped =
      columns.length >= 10 && strList(s.columns).length > 10
        ? `${columns.join(', ')}, …`
        : columns.join(', ');
    lines.push(`_Columns:_ ${clipped}`);
  }
  if (filters.length) {
    lines.push(`_Filters:_ ${filters.join(' · ')}`);
  }

  if (!lines.length && !query) return '';

  let footer = lines.join('\n');
  if (query && !tables.length && !columns.length && !filters.length) {
    const oneLine = query.replace(/\s+/g, ' ').trim();
    const clipped = oneLine.length > 160 ? `${oneLine.slice(0, 157)}…` : oneLine;
    if (!footer) footer = '_Source_';
    footer += `\n\`${clipped}\``;
  }
  return footer;
}
