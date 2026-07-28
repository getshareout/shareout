import { dispatchAction } from './dispatch';
import { jsonResponse } from './response';
import type { SDKEditorHandler } from './types';

export const handleGithubEditor: SDKEditorHandler = async (request, ctx, action) => {
  const { artifactId, env } = ctx;

  return dispatchAction(action, {
    get: async () => {
      const config = await env.DB.prepare(`
        SELECT repo, branch, auto_sync, last_commit, last_sync
        FROM artifact_github_config
        WHERE artifact_id = ?
      `).bind(artifactId).first<{
        repo: string;
        branch: string;
        auto_sync: number;
        last_commit: string;
        last_sync: string;
      }>();

      return jsonResponse({
        success: true,
        config: config ? {
          repo: config.repo,
          branch: config.branch,
          autoSync: config.auto_sync === 1,
          lastCommit: config.last_commit,
          lastSync: config.last_sync,
        } : null,
      });
    },

    update: async () => {
      const body = await request.json() as {
        repo: string;
        branch?: string;
        autoSync?: boolean;
      };

      await env.DB.prepare(`
        INSERT INTO artifact_github_config
        (artifact_id, repo, branch, auto_sync)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(artifact_id) DO UPDATE SET
          repo = excluded.repo,
          branch = excluded.branch,
          auto_sync = excluded.auto_sync
      `).bind(
        artifactId,
        body.repo,
        body.branch || 'main',
        body.autoSync ? 1 : 0
      ).run();

      return jsonResponse({ success: true });
    },
  });
};
