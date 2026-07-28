import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl } from '../helpers/env';

/**
 * Live Slack delivery flow against a real workspace Slack connection.
 *
 * Targets an EXISTING artifact in a workspace that already has a Slack
 * connection (e.g. Acme). Reads config from env so no secrets are baked in:
 *
 *   SLACK_E2E_TOKEN       ShareOut token that owns the artifact (falls back to
 *                         acme/credentials.json)
 *   SLACK_E2E_ARTIFACT    artifact id (art_…) in that workspace
 *   SLACK_E2E_CONNECTION  Slack connection name on the workspace (e.g. "team")
 *   SLACK_E2E_CHANNEL     test channel id (C…/G…)
 *   SLACK_E2E_USER        (optional) Slack member id (U…) for the DM test
 *
 * Run:  SLACK_E2E_TOKEN=… SLACK_E2E_ARTIFACT=art_… SLACK_E2E_CONNECTION=team \
 *       SLACK_E2E_CHANNEL=C0… npx vitest run -c vitest.e2e-live.config.ts \
 *       e2e-live/flows/16-slack-delivery.test.ts
 */
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

function resolveToken(): string | null {
  if (process.env.SLACK_E2E_TOKEN) return process.env.SLACK_E2E_TOKEN;
  const acme = join(packageRoot, 'acme', 'credentials.json');
  if (existsSync(acme)) {
    try {
      return (JSON.parse(readFileSync(acme, 'utf8')) as { token?: string }).token ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

const token = resolveToken();
const artifactId = process.env.SLACK_E2E_ARTIFACT;
const connection = process.env.SLACK_E2E_CONNECTION;
const channelId = process.env.SLACK_E2E_CHANNEL;
const slackUserId = process.env.SLACK_E2E_USER;

const configured = Boolean(token && artifactId && connection && channelId);

describe.skipIf(!configured)(`16 slack delivery @ ${baseUrl}`, () => {
  const client = ShareOutClient.withToken(token as string);
  let jobId = '';

  it('posts a message to the channel', async () => {
    const { response, body } = await client.shareToSlack(artifactId as string, {
      connection: connection as string,
      targetType: 'channel',
      channelId: channelId as string,
      mode: 'message',
      message: 'ShareOut e2e — message delivery',
    });
    expect(response.status, body?.error).toBe(200);
    expect(body).toMatchObject({ delivered: true });
  });

  it('uploads a snapshot to the channel', async () => {
    const { response, body } = await client.shareToSlack(artifactId as string, {
      connection: connection as string,
      targetType: 'channel',
      channelId: channelId as string,
      mode: 'snapshot',
      message: 'ShareOut e2e — snapshot',
    });
    expect(response.status, body?.error).toBe(200);
    expect(body).toMatchObject({ delivered: true });
  }, 60_000);

  it.skipIf(!slackUserId)('DMs the user', async () => {
    const { response, body } = await client.shareToSlack(artifactId as string, {
      connection: connection as string,
      targetType: 'dm',
      slackUserId: slackUserId as string,
      mode: 'message',
      message: 'ShareOut e2e — DM',
    });
    expect(response.status, body?.error).toBe(200);
    expect(body).toMatchObject({ delivered: true });
  });

  it('creates a scheduled slack job, runs it, then deletes it', async () => {
    const created = await client.createJob({
      artifact_id: artifactId as string,
      action: 'slack',
      schedule: '0 0 1 1 *', // Jan 1 — far future; we trigger it manually
      config: { connection, channelId, mode: 'message', customMessage: 'ShareOut e2e — scheduled run' },
    });
    expect(created.response.status, created.body?.error).toBe(201);
    jobId = created.body!.job!.id;

    const run = await client.runJob(jobId);
    expect(run.response.status, run.body?.execution?.error).toBe(200);
    expect(run.body?.execution?.success).toBe(true);

    const del = await client.deleteJob(jobId);
    expect(del.response.status).toBe(200);
    jobId = '';
  }, 30_000);
});
