import type { Env } from '../../types';
import { recordAiUsage } from '../../data/ai-usage';
import { whatsappServiceMicroUsd } from './rates';

/** The workspace a WhatsApp message is billed to, and who it was for. Null workspace = nobody is billed (setup messages before one is picked). */
export interface WhatsAppMeter {
  workspaceId: string | null;
  userId: string | null;
}

/**
 * Meter one message Meta accepted, at its list price for the recipient's market. It lands in
 * ai_usage_events — the one usage meter — so it counts toward the workspace's monthly budget
 * and shows on the admin report and the invoice at the workspace's markup, like AI usage.
 */
export async function meterWhatsAppMessage(env: Env, to: string, meter: WhatsAppMeter, messageId: string): Promise<void> {
  await recordAiUsage(env, {
    workspaceId: meter.workspaceId,
    userId: meter.userId,
    kind: 'whatsapp_message',
    model: 'whatsapp',
    units: 1,
    unitKind: 'messages',
    baseCostMicroUsd: whatsappServiceMicroUsd(to),
    source: 'whatsapp',
    costSource: 'estimate',
    providerRef: messageId,
  });
}
