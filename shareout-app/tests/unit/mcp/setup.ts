// Shared D1 fixture for the MCP connector tests: the real 0008 migration plus the
// slice of users/tokens it points at.
import { env } from 'cloudflare:test';
import mcpSql from '../../../migrations/0008_mcp_oauth.sql?raw';
import type { Env } from '../../../src/types';
import { generateToken, hashToken } from '../../../src/api-auth';

export const e = env as unknown as Env;

export async function createSchema(): Promise<void> {
  const base = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, username TEXT, name TEXT, disabled INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, principal_type TEXT NOT NULL, principal_id TEXT NOT NULL,
       user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE,
       name TEXT NOT NULL DEFAULT 'default', scopes TEXT, subject_external_user_id TEXT, created_by TEXT,
       created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), last_used_at TEXT, expires_at TEXT, revoked_at TEXT)`,
  ];
  const migration = mcpSql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sql of [...base, ...migration]) await e.DB.prepare(sql).run();
}

export async function resetData(): Promise<void> {
  for (const t of ['oauth_grants', 'oauth_codes', 'oauth_clients', 'tokens', 'users']) {
    await e.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await e.DB.prepare("INSERT INTO users (id, email, username) VALUES ('usr_1', 'ana@example.com', NULL)").run();
}

export async function personalToken(userId = 'usr_1'): Promise<string> {
  const token = generateToken();
  await e.DB.prepare(
    "INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES (?, 'user', ?, ?, ?, 'mcp:Claude')"
  ).bind(`tok_${crypto.randomUUID()}`, userId, userId, await hashToken(token)).run();
  return token;
}
