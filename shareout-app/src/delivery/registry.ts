import type { Destination } from './types';
import { slackDestination } from './destinations/slack';
import { emailDestination } from './destinations/email';
import { discordDestination } from './destinations/discord';
import { webhookDestination } from './destinations/webhook';
import { httpGetDestination } from './destinations/http-get';
import { materializeDestination } from './destinations/materialize';
import { telegramDestination } from './destinations/telegram';
import { querySnapshotDestination } from './destinations/query-snapshot';
import { sheetsAppendDestination } from './destinations/sheets-append';
import { artifactTestDestination } from './destinations/artifact-test';
import { assetDeliveryDestination } from './destinations/asset-delivery';

const REGISTRY: Record<string, Destination<any>> = {
  slack: slackDestination,
  email: emailDestination,
  discord: discordDestination,
  webhook: webhookDestination,
  http_get: httpGetDestination,
  materialize: materializeDestination,
  telegram: telegramDestination,
  query_snapshot: querySnapshotDestination,
  sheets_append: sheetsAppendDestination,
  artifact_test: artifactTestDestination,
  asset_delivery: assetDeliveryDestination,
};

export function getDestination(kind: string): Destination<any> | null {
  return REGISTRY[kind] ?? null;
}

export type { Destination, DeliveryContext, DeliveryResult } from './types';
