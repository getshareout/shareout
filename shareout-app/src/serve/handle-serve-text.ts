import type { Env } from '../types';
import type { ArtifactInfo } from './types';
import { getCachedDeployment, cacheDeployment, buildCacheRecord, fetchAssetRow } from './deployment-cache';
import { checkAccess } from './access';
import { extractTextFromHtml } from './utils';

export async function handleServeText(
  request: Request,
  env: Env,
  slug: string
): Promise<Response> {
  // Try KV cache first for deployment info
  let cached = await getCachedDeployment(env, slug);
  let result: ArtifactInfo & { r2_key: string | null; mime: string | null } | null = null;

  if (cached) {
    const asset = await env.DB.prepare(`
      SELECT r2_key, mime FROM assets
      WHERE version_id = ? AND path = ?
    `).bind(cached.version_id, cached.entrypoint).first<{ r2_key: string; mime: string }>();

    result = {
      ...cached,
      r2_key: asset?.r2_key || null,
      mime: asset?.mime || null,
    };
  } else {
    const dbResult = await env.DB.prepare(`
      SELECT d.version_id, v.entrypoint, v.mobile_entrypoint, v.artifact_id, v.manifest_json,
             a.name as artifact_name,
             a.description, pres_a.social_title, pres_a.social_description, pres_a.social_image_url,
             pres_a.thumbnail_ext,
             a.visibility, a.auth_method, a.owner_id, a.workspace_id, a.paused,
             COALESCE(pres_a.has_mobile, 0) AS has_mobile, pres_a.pwa_config,
             a.artifact_type, a.type_metadata, a.access_policy,
             ast.r2_key, ast.mime, ast.size_bytes
      FROM deployments d
      JOIN versions v ON v.id = d.version_id
      JOIN artifacts a ON a.id = v.artifact_id
      LEFT JOIN artifact_presentation pres_a ON pres_a.artifact_id = a.id
      LEFT JOIN assets ast ON ast.version_id = v.id AND ast.path = v.entrypoint
      WHERE d.slug = ? AND d.channel = 'production'
    `).bind(slug).first<ArtifactInfo & { r2_key: string; mime: string; size_bytes: number }>();

    if (dbResult) {
      result = dbResult;
      // Write the full cache record so the HTML serve path (same KV key) can trust
      // entry_asset / access_policy on its cache hits.
      const webEntryAsset = dbResult.r2_key && dbResult.mime && dbResult.size_bytes
        ? { r2_key: dbResult.r2_key, mime: dbResult.mime, size_bytes: dbResult.size_bytes }
        : null;
      const mobileEntryAsset = dbResult.has_mobile && dbResult.mobile_entrypoint
        ? await fetchAssetRow(env, dbResult.version_id, dbResult.mobile_entrypoint)
        : null;
      await cacheDeployment(env, slug, buildCacheRecord(dbResult, webEntryAsset, mobileEntryAsset));
    }
  }

  if (!result) {
    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }

  if (result.paused === 1) {
    return new Response('This content is temporarily unavailable.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }

  const visibility = result.visibility || 'public';
  if (visibility === 'private' || visibility === 'workspace') {
    const accessResult = await checkAccess(request, env, slug, result);
    if (accessResult) {
      return new Response('Unauthorized', { status: 401, headers: { 'Content-Type': 'text/plain' } });
    }
  }

  if (!result.r2_key) {
    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }

  const obj = await env.ARTIFACTS.get(result.r2_key);
  if (!obj) {
    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }

  const html = await obj.text();
  const text = extractTextFromHtml(html);

  const output = `---
title: ${result.artifact_name}
slug: ${slug}
---

${text}`;

  return new Response(output, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}