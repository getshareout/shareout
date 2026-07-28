/**
 * HTML-specific side effects during publish — social meta, editor readiness,
 * and followable metric registration. All best-effort; never block publish.
 */
import type { ArtifactType, Env } from '../types';
import type { AuthUser } from '../api-auth';
import { extractSocialMetaFromHtml } from '../serve/social-meta';
import { syncMetricsFromHtml } from '../metric-alerts/definitions';
import { buildModelFromHtml } from '../../shared/editor-readiness/from-html';
import { evaluateReadiness } from '../../shared/editor-readiness/evaluate';
import type { ReadinessProfile } from '../../shared/editor-readiness/model';
import { setPresentation } from '../artifacts/satellites';

export async function enrichHtmlArtifact(
  env: Env,
  artifactId: string,
  htmlContent: string,
  user: AuthUser,
  artifactType: ArtifactType,
): Promise<ReadinessProfile | undefined> {
  if (!htmlContent || artifactType !== 'html') return undefined;

  const social = extractSocialMetaFromHtml(htmlContent);
  await setPresentation(env, artifactId, {
    social_title: social.title,
    social_description: social.description,
    social_image_url: social.imageUrl,
  });

  let editorReadiness: ReadinessProfile | undefined;
  try {
    editorReadiness = evaluateReadiness(await buildModelFromHtml(htmlContent));
    await setPresentation(env, artifactId, { editor_readiness: JSON.stringify(editorReadiness) });
  } catch {
    editorReadiness = undefined;
  }

  try {
    await syncMetricsFromHtml(env, artifactId, htmlContent, user.id);
  } catch {
    // Metric registration is a convenience, not part of publishing.
  }

  return editorReadiness;
}
