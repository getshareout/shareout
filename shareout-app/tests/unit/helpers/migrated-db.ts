// Applies the real migrations to the test D1 so queries run against the production
// schema (a hand-written fixture table would have hidden `ae.timestamp`).
import { env } from 'cloudflare:workers';
import type { Env } from '../../../src/types';

const files = import.meta.glob('../../../migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const e = env as unknown as Env;

let applied: Promise<void> | null = null;

export function applyMigrations(): Promise<void> {
  applied ??= (async () => {
    for (const path of Object.keys(files).sort()) {
      const statements = files[path]
        .replace(/--[^\n]*/g, '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const sql of statements) await e.DB.prepare(sql).run();
    }
  })();
  return applied;
}
