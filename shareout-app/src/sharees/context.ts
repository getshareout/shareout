// External-sharing spine (work/030) — feed Client notes to the workspace AI.
// When the workspace/home assistant runs, every Client is potentially "in context",
// so we inject each Client's notes (account intel) into the snapshot up to a byte
// budget, with a manifest for any overflow. Reuses buildShareeContextDoc.
import type { Env } from '../types';
import { buildShareeContextDoc } from '../workspace-context';

const SNAPSHOT_BUDGET = 12_000; // bytes of client notes injected per assistant turn

export async function buildClientsContextForWorkspace(env: Env, workspaceId: string): Promise<string> {
  const { results: clients } = await env.DB.prepare(
    `SELECT s.id, s.name FROM sharees s
      WHERE s.workspace_id = ?
        AND EXISTS (SELECT 1 FROM workspace_files f WHERE f.namespace = 'context' AND f.scope_id = s.id)
      ORDER BY s.name`
  ).bind(workspaceId).all<{ id: string; name: string }>();
  if (!clients?.length) return '';

  const parts: string[] = [
    'Client notes (internal — what we know about each client; never share with them):',
    '',
  ];
  // Build all docs concurrently; apply the byte budget in client order afterwards
  // so the output is identical to the old sequential loop.
  const docs = await Promise.all(clients.map((c) => buildShareeContextDoc(env, workspaceId, c.id, c.name)));
  let used = 0;
  const overflow: string[] = [];
  clients.forEach((c, i) => {
    const doc = docs[i];
    if (!doc) return;
    if (used + doc.length > SNAPSHOT_BUDGET) { overflow.push(c.name); return; }
    parts.push(doc, '');
    used += doc.length;
  });
  if (overflow.length) {
    parts.push(`More client notes available on request: ${overflow.join(', ')}.`, '');
  }
  return parts.join('\n');
}
