import type { Destination } from '../types';
import type { AssetDeliveryConfig } from '../../scheduling/jobs/types';
import { createShareLink } from '../../assets/deliverables';
import { dispatchLifecycleEmail } from '../../email/gateway';

// Scheduled file delivery (work/042 P4): email a file-collection download link on a
// schedule. The job is anchored to the workspace's asset-bucket artifact (ctx.artifactId),
// and the collection must live in that bucket — so a job can only deliver its own files.
export const assetDeliveryDestination: Destination<AssetDeliveryConfig> = {
  kind: 'asset_delivery',

  async validate(env, ctx, config) {
    if (!config.collectionId) return 'collectionId is required';
    if (!config.recipients?.length) return 'At least one recipient is required';
    if (config.recipients.length > 10) return 'Maximum 10 recipients per delivery';
    for (const email of config.recipients) {
      if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return `Invalid email: ${email}`;
    }
    const col = await env.DB.prepare('SELECT bucket_artifact_id FROM asset_collections WHERE id = ?')
      .bind(config.collectionId).first<{ bucket_artifact_id: string }>();
    if (!col) return 'Collection not found';
    if (col.bucket_artifact_id !== ctx.artifactId) return 'Collection is not in this file library';
    return null;
  },

  async deliver(env, ctx, config) {
    const col = await env.DB.prepare('SELECT name, bucket_artifact_id FROM asset_collections WHERE id = ?')
      .bind(config.collectionId).first<{ name: string; bucket_artifact_id: string }>();
    if (!col || col.bucket_artifact_id !== ctx.artifactId) return { success: false, error: 'Collection not found in this library' };

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM asset_collection_items WHERE collection_id = ?')
      .bind(config.collectionId).first<{ n: number }>();
    const expiresAt = config.expiresDays && config.expiresDays > 0
      ? new Date(Date.now() + config.expiresDays * 86_400_000).toISOString()
      : null;

    const link = await createShareLink(env, config.collectionId, ctx.createdBy, { expiresAt });
    for (const to of config.recipients) {
      await dispatchLifecycleEmail(env, {
        type: 'asset_delivery',
        toEmail: to,
        data: { collectionName: col.name || 'Files', downloadUrl: link.url, fileCount: count?.n || 0, senderName: '', expiresAt },
      }).catch(() => {});
    }
    return {
      success: true,
      steps: [{ step: 'deliver', status: 'success', detail: { recipients: config.recipients.length, url: link.url } }],
    };
  },
};
