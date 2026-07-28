import type { Env } from '../../types';
import type { DataContext } from '../middleware';
import type { MiniDb } from '../minidb-client';
import type { AgentConfig, VisitorContext, AdminContext } from './types';

export async function buildVisitorContext(
  ctx: DataContext,
  config: AgentConfig
): Promise<VisitorContext> {
  const { db, env, artifactId } = ctx;
  const context: VisitorContext = {
    json: {},
    tables: {},
    blobUrls: [],
  };

  // JSON + tables live in the per-artifact minidb (ctx.db), not D1.
  if (config.visitor_context_json) {
    const jsonRows = await db.prepare(`
      SELECT key, value FROM artifact_json
      WHERE artifact_id = ?
      ORDER BY updated_at DESC
      LIMIT 100
    `).bind(artifactId).all<{ key: string; value: string }>();

    for (const row of jsonRows.results as Array<{ key: string; value: string }>) {
      try {
        context.json[row.key] = JSON.parse(row.value);
      } catch {
        context.json[row.key] = row.value;
      }
    }
  }

  // Load table samples if specified
  if (config.visitor_context_tables) {
    const tables = typeof config.visitor_context_tables === 'string'
      ? JSON.parse(config.visitor_context_tables)
      : config.visitor_context_tables;

    for (const tableName of tables as string[]) {
      context.tables[tableName] = await loadTableSamples(db, artifactId, tableName);
    }
  }

  // Blob metadata lives in D1 (`blobs` table).
  if (config.visitor_context_blobs) {
    const blobs = await env.DB.prepare(`
      SELECT id, filename FROM blobs
      WHERE artifact_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).bind(artifactId).all<{ id: string; filename: string }>();

    context.blobUrls = blobs.results.map((b) =>
      `/v1/data/${artifactId}/blobs/${b.id}`
    );
  }

  return context;
}

export async function buildAdminContext(
  ctx: DataContext
): Promise<AdminContext> {
  const { db, env, artifactId } = ctx;
  // Get artifact info
  const artifact = await env.DB.prepare(`
    SELECT a.id, a.name, a.visibility, a.folder_id, v.version_no
    FROM artifacts a
    JOIN versions v ON v.artifact_id = a.id
    WHERE a.id = ?
    ORDER BY v.version_no DESC
    LIMIT 1
  `).bind(artifactId).first<{
    id: string;
    name: string;
    visibility: string;
    folder_id: string | null;
    version_no: number;
  }>();

  if (!artifact) {
    throw new Error('Artifact not found');
  }

  // The folder's guide (README) carries conventions the editing agent should follow.
  let folderGuide: string | null = null;
  if (artifact.folder_id) {
    const f = await env.DB.prepare('SELECT readme FROM folders WHERE id = ?')
      .bind(artifact.folder_id).first<{ readme: string | null }>();
    folderGuide = f?.readme?.trim() || null;
  }

  // Get latest version's assets (files)
  const latestVersion = await env.DB.prepare(`
    SELECT id FROM versions
    WHERE artifact_id = ?
    ORDER BY version_no DESC
    LIMIT 1
  `).bind(artifactId).first<{ id: string }>();

  const files: Array<{ path: string; content: string; mime: string }> = [];

  if (latestVersion) {
    const assets = await env.DB.prepare(`
      SELECT path, r2_key, mime FROM assets
      WHERE version_id = ?
    `).bind(latestVersion.id).all();

    for (const asset of assets.results as Array<{ path: string; r2_key: string; mime: string }>) {
      // Only include text-based files
      if (isTextMime(asset.mime)) {
        const obj = await env.ARTIFACTS.get(asset.r2_key);
        if (obj) {
          const content = await obj.text();
          files.push({
            path: asset.path,
            content,
            mime: asset.mime,
          });
        }
      }
    }
  }

  // Get skill docs
  const skillDocs = await getSkillDocs(env);

  // JSON + tables live in the per-artifact minidb (ctx.db), not D1.
  const jsonRows = await db.prepare(`
    SELECT key, value FROM artifact_json
    WHERE artifact_id = ?
    LIMIT 100
  `).bind(artifactId).all<{ key: string; value: string }>();

  const json: Record<string, unknown> = {};
  for (const row of jsonRows.results as Array<{ key: string; value: string }>) {
    try {
      json[row.key] = JSON.parse(row.value);
    } catch {
      json[row.key] = row.value;
    }
  }

  const tableRows = await db.prepare(`
    SELECT name FROM artifact_tables WHERE artifact_id = ? ORDER BY name
  `).bind(artifactId).all<{ name: string }>();

  const tables = tableRows.results.map((r) => r.name);

  return {
    files,
    skillDocs,
    artifact: {
      id: artifact.id,
      name: artifact.name,
      visibility: artifact.visibility,
      currentVersion: artifact.version_no,
    },
    json,
    tables,
    folderGuide,
  };
}

async function loadTableSamples(
  db: MiniDb,
  artifactId: string,
  tableName: string,
  limit: number = 10
): Promise<unknown[]> {
  const table = await db.prepare(
    'SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?'
  ).bind(artifactId, tableName).first<{ id: string }>();

  if (!table) return [];

  const rows = await db.prepare(`
    SELECT data FROM artifact_rows
    WHERE table_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(table.id, limit).all<{ data: string }>();

  return rows.results.map((r) => {
    try {
      return JSON.parse(r.data);
    } catch {
      return r.data;
    }
  });
}

function isTextMime(mime: string): boolean {
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/javascript' ||
    mime === 'application/xml' ||
    mime === 'application/xhtml+xml' ||
    mime.endsWith('+json') ||
    mime.endsWith('+xml')
  );
}

export async function getSkillDocs(env: Env): Promise<string> {
  // Return a condensed version of the SDK docs for the AI context
  return `# ShareOut SDK Reference

## Data Storage

### JSON Store (Key-Value)
\`\`\`javascript
await shareout.json.get(key)           // Get value
await shareout.json.set(key, value)    // Set value
await shareout.json.delete(key)        // Delete key
await shareout.json.merge(key, partial) // Merge into object
shareout.json.subscribe(key, handler)  // Watch for changes
\`\`\`

### Tables (Structured Data)
\`\`\`javascript
const table = shareout.table('items');
await table.insert({ name: 'Item 1' })
await table.find({ status: 'active' }).sort('createdAt', 'desc').limit(10).exec()
await table.updateById(id, { status: 'done' })
await table.deleteById(id)
\`\`\`

### Real-time Collaboration
\`\`\`javascript
const doc = shareout.realtime('document');
await doc.connect();
doc.text('content').insert(0, 'Hello');
doc.presence.set({ cursor: { x, y } });
\`\`\`

## File Storage
\`\`\`javascript
await shareout.blobs.upload(file)
shareout.blobs.getUrl(blobId)
await shareout.blobs.list()
\`\`\`

## External Integrations
\`\`\`javascript
// Google Sheets
await shareout.sheets.authorize()
await shareout.sheets.fetch({ spreadsheetId, range })

// GitHub Export
await shareout.github.authorize()
await shareout.github.export({ repo, branch })
\`\`\`

## Comments
\`\`\`javascript
await shareout.comments.add({ content, contextId })
await shareout.comments.find({ contextId }).exec()
\`\`\`

## User & Theme
\`\`\`javascript
const user = await shareout.user.current()
const theme = shareout.theme.current()
\`\`\`
`;
}

export function buildVisitorSystemPrompt(
  customPrompt: string | null,
  context: VisitorContext
): string {
  let prompt = customPrompt || 'You are a helpful assistant for this application.';

  // The page may attach a per-message "Live page data" JSON block (sdk.agent.chat
  // `context`) carrying the artifact's current on-screen state. Tell the model to
  // trust it, so live-data dashboards work without the owner hand-writing this rule.
  prompt += '\n\nIf a user message contains a "Live page data" JSON block, it is the current state of the app the user is viewing — treat it as authoritative, answer from it, and never ask the user to paste data that is already provided there.';

  if (Object.keys(context.json).length > 0) {
    prompt += '\n\n## Available Data\n```json\n' + JSON.stringify(context.json, null, 2) + '\n```';
  }

  if (Object.keys(context.tables).length > 0) {
    prompt += '\n\n## Available Tables';
    for (const [name, rows] of Object.entries(context.tables)) {
      prompt += `\n### ${name} (${rows.length} sample rows)\n\`\`\`json\n${JSON.stringify(rows, null, 2)}\n\`\`\``;
    }
  }

  if (context.blobUrls.length > 0) {
    prompt += '\n\n## Available Files\n' + context.blobUrls.join('\n');
  }

  return prompt;
}

export function buildAdminSystemPrompt(context: AdminContext): string {
  let prompt = `You are an AI assistant helping the owner edit their ShareOut artifact "${context.artifact.name}".

When suggesting code changes:
1. Show the exact file path
2. Use diff format or show the complete new code
3. Explain what the change does
4. Mark changes clearly with \`\`\`diff blocks
`;

  if (context.folderGuide) {
    prompt += `\nThis artifact lives in a folder with a guide. Follow its conventions for anything you build or change here:\n\n## Folder guide\n${context.folderGuide}\n`;
  }

  prompt += `\n## Artifact Files
`;

  for (const file of context.files) {
    prompt += `\n### ${file.path}\n\`\`\`${getLanguageForMime(file.mime)}\n${file.content}\n\`\`\`\n`;
  }

  prompt += '\n' + context.skillDocs;

  if (Object.keys(context.json).length > 0) {
    prompt += '\n\n## Current Data Store\n```json\n' + JSON.stringify(context.json, null, 2) + '\n```';
  }

  if (context.tables.length > 0) {
    prompt += '\n\n## Available Tables: ' + context.tables.join(', ');
  }

  return prompt;
}

function getLanguageForMime(mime: string): string {
  const map: Record<string, string> = {
    'text/html': 'html',
    'text/css': 'css',
    'application/javascript': 'javascript',
    'text/javascript': 'javascript',
    'application/json': 'json',
    'text/markdown': 'markdown',
    'text/plain': 'text',
  };
  return map[mime] || 'text';
}
