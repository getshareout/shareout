import { beforeAll, describe, expect, it } from 'vitest';
import { handleDataRequest } from '../../../src/data/router';
import { createSessionToken } from '../../../src/token';
import { applyMigrations, e } from '../helpers/migrated-db';

const ART = 'art_h5_slides';
const PRES = 'pres_' + 'c'.repeat(24);
const owner = { id: 'usr_h5s_owner', email: 'h5sowner@x.test' };
const stranger = { id: 'usr_h5s_stranger', email: 'h5sstranger@x.test' };

beforeAll(async () => {
  await applyMigrations();
  (e as { SESSION_SECRET?: string }).SESSION_SECRET ||= 'test-session-secret-h5s';
  await e.DB.batch([
    e.DB.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').bind(owner.id, owner.email),
    e.DB.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').bind(stranger.id, stranger.email),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, ?, ?, 'public')").bind(ART, ART, `s-${ART}`, owner.id),
    e.DB.prepare("INSERT INTO presentations (id, artifact_id, title, visibility) VALUES (?, ?, 'deck', 'public')").bind(PRES, ART),
  ]);
});

async function call(user: { id: string; email: string } | null, path: string, body: unknown = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user) headers.Cookie = `shareout_session=${await createSessionToken(user.id, user.email, e)}`;
  return handleDataRequest(new Request(`https://so.test/v1/data/${ART}/slides/${PRES}/presenter/${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  }), e, `${ART}/slides/${PRES}/presenter/${path}`);
}

describe('h5 slides presenter start/stop', () => {
  it('blocks: a visitor cannot start or stop presenting', async () => {
    expect((await call(stranger, 'start')).status).toBe(403);
    expect((await call(null, 'start')).status).toBe(403);
    expect((await call(null, 'stop')).status).toBe(403);
    expect((await call(stranger, 'stop')).status).toBe(403);
  });

  it('the owner can start and stop', async () => {
    expect((await call(owner, 'start')).status).toBe(200);
    expect((await call(owner, 'stop')).status).toBe(200);
  });
});
