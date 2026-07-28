/**
 * MONITOR-mode post-publish artifact tests.
 * No-ops unless tests are enabled. Runs off the response via waitUntil.
 */
import type { Env } from '../types';
import { getTestConfig } from '../tests/config';
import { runTests } from '../tests/runner';

export async function maybeRunMonitorTests(
  env: Env,
  artifactId: string,
  workspaceId: string,
  versionId: string,
): Promise<void> {
  const config = await getTestConfig(env, artifactId);
  if (!config?.enabled) return;
  await runTests(env, { artifactId, workspaceId, versionId, trigger: 'publish', triggeredBy: null });
}
