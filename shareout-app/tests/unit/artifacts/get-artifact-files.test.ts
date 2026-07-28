// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleGetArtifactFiles } from '../../../src/artifacts';
import {
  artifactRow,
  baseEnv,
  jsonBody,
  makeDbMock,
  makeR2Mock,
  makeSlugsMock,
  ownerRoleFirst,
  user,
} from './shared';

describe('handleGetArtifactFiles', () => {
  it('returns 404 when artifact is missing', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: () => null }),
    };

    const response = await handleGetArtifactFiles(
      new Request('https://shareout.example.com/v1/artifacts/art_missing/files'),
      env,
      user,
      'art_missing',
    );

    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 403 when user lacks viewer access', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('owner_id FROM artifacts') && sql.includes('SELECT id, owner_id')) {
            return { id: 'art_1', owner_id: 'usr_other' };
          }
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_other' };
          if (sql.includes('email FROM users')) return { email: 'owner@example.com' };
          return null;
        },
      }),
    };

    const response = await handleGetArtifactFiles(
      new Request('https://shareout.example.com/v1/artifacts/art_1/files'),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('returns 404 when version cannot be resolved', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id, owner_id FROM artifacts')) return { id: 'art_1', owner_id: 'usr_1' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('version_id FROM deployments')) return null;
          return null;
        },
      }),
    };

    const response = await handleGetArtifactFiles(
      new Request('https://shareout.example.com/v1/artifacts/art_1/files'),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });

  it('returns text and binary files for a production deployment', async () => {
    const textObject = { text: vi.fn(async () => 'console.log("hi")'), arrayBuffer: vi.fn() };
    const binaryBytes = new Uint8Array([0, 1, 2]);
    const binaryObject = {
      text: vi.fn(),
      arrayBuffer: vi.fn(async () => binaryBytes.buffer),
    };

    const env = {
      ...baseEnv,
      ARTIFACTS: makeR2Mock((key) => {
        if (key === 'artifacts/ver_1/index.js') return textObject;
        if (key === 'artifacts/ver_1/logo.png') return binaryObject;
        return null;
      }),
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT id, owner_id FROM artifacts')) return { id: 'art_1', owner_id: 'usr_1' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('version_id FROM deployments')) return { version_id: 'ver_1' };
          if (sql.includes('entrypoint FROM versions WHERE id = ?')) {
            return { id: 'ver_1', version_no: 1, entrypoint: 'index.html' };
          }
          return null;
        },
        all: (sql) => {
          if (sql.includes('FROM assets WHERE version_id')) {
            return {
              results: [
                { path: 'index.js', r2_key: 'artifacts/ver_1/index.js', mime: 'application/javascript', size_bytes: 20 },
                { path: 'logo.png', r2_key: 'artifacts/ver_1/logo.png', mime: 'image/png', size_bytes: 3 },
              ],
            };
          }
          return { results: [] };
        },
      }),
    };

    const response = await handleGetArtifactFiles(
      new Request('https://shareout.example.com/v1/artifacts/art_1/files'),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(body).toMatchObject({
      artifact_id: 'art_1',
      version_id: 'ver_1',
      version_no: 1,
      entrypoint: 'index.html',
    });
    expect(body.files).toEqual([
      {
        path: 'index.js',
        content: 'console.log("hi")',
        encoding: 'utf8',
        mime: 'application/javascript',
        size_bytes: 20,
      },
      {
        path: 'logo.png',
        content: btoa(String.fromCharCode(0, 1, 2)),
        encoding: 'base64',
        mime: 'image/png',
        size_bytes: 3,
      },
    ]);
  });

  it('loads a specific version by version number or version id', async () => {
    const textObject = { text: vi.fn(async () => 'v2'), arrayBuffer: vi.fn() };
    const makeEnv = (url: string) => ({
      ...baseEnv,
      ARTIFACTS: makeR2Mock(() => textObject),
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT id, owner_id FROM artifacts')) return { id: 'art_1', owner_id: 'usr_1' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('version_no = ?')) {
            expect(args[1]).toBe(2);
            return { id: 'ver_2', version_no: 2, entrypoint: 'index.html' };
          }
          if (sql.includes('versions WHERE id = ? AND artifact_id = ?')) {
            expect(args[0]).toBe('ver_custom');
            return { id: 'ver_custom', version_no: 5, entrypoint: 'index.html' };
          }
          return null;
        },
        all: (sql) => {
          if (sql.includes('FROM assets WHERE version_id')) {
            return {
              results: [{
                path: 'index.html',
                r2_key: 'artifacts/ver_2/index.html',
                mime: 'text/html',
                size_bytes: 2,
              }],
            };
          }
          return { results: [] };
        },
      }),
    });

    const byNumber = await handleGetArtifactFiles(
      new Request('https://shareout.example.com/v1/artifacts/art_1/files?version=2'),
      makeEnv('version=2'),
      user,
      'art_1',
    );
    expect(byNumber.status).toBe(200);
    expect((await jsonBody(byNumber)).version_no).toBe(2);

    const byId = await handleGetArtifactFiles(
      new Request('https://shareout.example.com/v1/artifacts/art_1/files?version=ver_custom'),
      makeEnv('version=ver_custom'),
      user,
      'art_1',
    );
    expect(byId.status).toBe(200);
    expect((await jsonBody(byId)).version_id).toBe('ver_custom');
  });

  it('skips missing R2 objects', async () => {
    const env = {
      ...baseEnv,
      ARTIFACTS: makeR2Mock(() => null),
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id, owner_id FROM artifacts')) return { id: 'art_1', owner_id: 'usr_1' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('version_id FROM deployments')) return { version_id: 'ver_1' };
          if (sql.includes('entrypoint FROM versions WHERE id = ?')) {
            return { id: 'ver_1', version_no: 1, entrypoint: 'index.html' };
          }
          return null;
        },
        all: (sql) => {
          if (sql.includes('FROM assets WHERE version_id')) {
            return {
              results: [{
                path: 'missing.html',
                r2_key: 'artifacts/ver_1/missing.html',
                mime: 'text/html',
                size_bytes: 0,
              }],
            };
          }
          return { results: [] };
        },
      }),
    };

    const response = await handleGetArtifactFiles(
      new Request('https://shareout.example.com/v1/artifacts/art_1/files'),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    expect((await jsonBody(response)).files).toEqual([]);
  });
});

