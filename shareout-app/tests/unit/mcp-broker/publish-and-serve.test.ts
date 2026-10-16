import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import type { PublishRequest } from '../../../src/types';
import { resolveRequestedCapabilities } from '../../../src/publish/capabilities';
import {
  carriedManifestJson,
  hasMcpCapability,
  mcpCapabilityHash,
  parseMcpCapabilityInput,
} from '../../../src/mcp-broker/capabilities';
import { getSandboxedCSP, SANDBOX_PERMISSIONS, SANDBOX_PERMISSIONS_LOCKED } from '../../../src/serve/security';
import { renderMcpHostBridge } from '../../../src/serve/sandbox-viewer/bridge-script';

const WS = 'wsp_pub_mcp';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT OR IGNORE INTO users (id, email) VALUES ('usr_pm', 'pm@x.test')"),
    e.DB.prepare("INSERT OR IGNORE INTO workspaces (id, name, slug, owner_id) VALUES (?, 'P', 'pub-mcp', 'usr_pm')").bind(WS),
    e.DB.prepare(`INSERT OR IGNORE INTO connections (id, scope_type, scope_id, name, kind, provider, credential_scope, config)
      VALUES ('conn_pm', 'workspace', ?, 'notion', 'platform', 'mcp', 'per_user', '{}')`).bind(WS),
    e.DB.prepare(`INSERT OR IGNORE INTO connections (id, scope_type, scope_id, name, kind, provider, credential_scope, config)
      VALUES ('conn_pm_rest', 'workspace', ?, 'rest', 'generic', 'rest_api', 'shared', '{}')`).bind(WS),
  ]);
});

const body = (capabilities: unknown) => ({ capabilities } as unknown as PublishRequest);

describe('capability declaration', () => {
  it('normalizes: sorted, de-duplicated tools; stable hash regardless of order', async () => {
    const a = parseMcpCapabilityInput({ connections: [{ name: 'notion', tools: ['search', 'fetch', 'search'] }] });
    const b = parseMcpCapabilityInput({ connections: [{ name: 'notion', tools: ['fetch', 'search'] }] });
    expect(a.ok && a.value).toEqual({ connections: [{ name: 'notion', tools: ['fetch', 'search'] }] });
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(await mcpCapabilityHash(a.value)).toBe(await mcpCapabilityHash(b.value));
  });

  it('rejects empty tool lists (never "all tools"), bad names and duplicates', () => {
    expect(parseMcpCapabilityInput({ connections: [{ name: 'notion', tools: [] }] }).ok).toBe(false);
    expect(parseMcpCapabilityInput({ connections: [] }).ok).toBe(false);
    expect(parseMcpCapabilityInput({ connections: [{ name: 'no spaces', tools: ['x'] }] }).ok).toBe(false);
    expect(parseMcpCapabilityInput({ connections: [{ name: 'a', tools: ['x'] }, { name: 'a', tools: ['y'] }] }).ok).toBe(false);
  });
});

describe('publish validation', () => {
  it('omitted keeps, null clears, valid declarations normalize', async () => {
    expect(await resolveRequestedCapabilities(e, {} as PublishRequest, WS, 'workspace')).toBeUndefined();
    expect(await resolveRequestedCapabilities(e, body({ mcp: null }), WS, 'workspace')).toEqual({ mcp: null });
    expect(await resolveRequestedCapabilities(e, body({ mcp: { connections: [{ name: 'notion', tools: ['search'] }] } }), WS, 'private'))
      .toEqual({ mcp: { connections: [{ name: 'notion', tools: ['search'] }] } });
  });

  it('refuses public or personal pages and names that are not MCP connections', async () => {
    const decl = body({ mcp: { connections: [{ name: 'notion', tools: ['search'] }] } });
    for (const [ws, vis] of [[WS, 'public'], [WS, 'unlisted'], [null, 'private']] as const) {
      const r = await resolveRequestedCapabilities(e, decl, ws, vis);
      expect(r instanceof Response && r.status, `${ws}/${vis}`).toBe(400);
      expect(r instanceof Response && ((await r.json()) as { code: string }).code).toBe('MCP_REQUIRES_MEMBERS_ONLY');
    }
    const rest = await resolveRequestedCapabilities(e, body({ mcp: { connections: [{ name: 'rest', tools: ['x'] }] } }), WS, 'workspace');
    expect(rest instanceof Response && ((await rest.json()) as { code: string }).code).toBe('UNKNOWN_MCP_CONNECTION');
  });

  it('editor saves inherit the live declaration', async () => {
    const cap = { mcp: { connections: [{ name: 'notion', tools: ['search'] }] } };
    await e.DB.batch([
      e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES ('art_carry', 'c', 'carry', 'usr_pm', ?, 'workspace')").bind(WS),
      e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES ('ver_carry', 'art_carry', 1, 'index.html', ?)")
        .bind(JSON.stringify({ version: 2, capabilities: cap })),
      e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES ('dep_carry', 'art_carry', 'ver_carry', 'production', 'carry')"),
    ]);
    const carried = await carriedManifestJson(e, 'art_carry');
    expect(JSON.parse(carried)).toEqual({ capabilities: cap });
    expect(hasMcpCapability(carried)).toBe(true);
    expect(await carriedManifestJson(e, 'art_missing')).toBe('{}');
  });
});

describe('serving MCP pages', () => {
  const origin = 'https://abc.shareoutcdn.test';
  const directives = (csp: string) => Object.fromEntries(csp.split('; ').map((d) => [d.split(' ')[0], d]));

  it('locks egress: no https: wildcard on connect/img/media/frame, tight script list even when private', () => {
    const locked = directives(getSandboxedCSP(origin, true, e, true));
    for (const key of ['connect-src', 'img-src', 'media-src', 'frame-src', 'script-src', 'style-src', 'font-src']) {
      expect(locked[key], key).not.toMatch(/ https:( |$)/);
      expect(locked[key], key).not.toMatch(/ http:( |$)/);
    }
    expect(locked['connect-src']).toContain(origin);
    expect(locked['connect-src']).toContain('https://shareout.test');

    const relaxed = directives(getSandboxedCSP(origin, true, e, false));
    expect(relaxed['connect-src']).toMatch(/https:/);
  });

  it('drops popups from the sandbox', () => {
    expect(SANDBOX_PERMISSIONS).toContain('allow-popups');
    expect(SANDBOX_PERMISSIONS_LOCKED).not.toContain('allow-popups');
    expect(SANDBOX_PERMISSIONS_LOCKED).toContain('allow-scripts');
    expect(SANDBOX_PERMISSIONS_LOCKED).not.toContain('allow-same-origin');
  });

  it('emits a host bridge script that parses', () => {
    const html = renderMcpHostBridge('art_"x');
    const js = html.replace(/^<script>/, '').replace(/<\/script>$/, '');
    expect(() => new Function(js)).not.toThrow();
    expect(js).toContain(JSON.stringify('art_"x'));
  });
});
