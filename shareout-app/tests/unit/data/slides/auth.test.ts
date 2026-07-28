// @vitest-environment node
import './setup';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataContext } from '../../../../src/data/middleware';
import * as middleware from '../../../../src/data/middleware';
import { canEditPresentation, canEditSlide, getSession } from '../../../../src/data/slides/auth';
import { makeSlide } from '../slides-mock-db';
import type { Env } from '../../../../src/types';
import { createSlidesDb, makePresentation } from '../slides-mock-db';
import { ARTIFACT_ID, PRES_ID, makeCtx } from './shared';


describe('slides auth', () => {
  const ctxBase = makeCtx(createSlidesDb().db);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getSession returns null without cookie', async () => {
    await expect(getSession(new Request('https://example.com'), ctxBase)).resolves.toBeNull();
  });

  it('getSession returns user when session token is valid', async () => {
    vi.spyOn(await import('../../../../src/token'), 'verifySessionToken').mockResolvedValue({
      userId: 'usr_1',
      email: 'user@example.com',
    });
    const request = new Request('https://example.com', {
      headers: { Cookie: 'shareout_session=token123' },
    });
    await expect(getSession(request, ctxBase)).resolves.toEqual({
      userId: 'usr_1',
      email: 'user@example.com',
      name: 'user@example.com',
    });
  });

  function makeCtxWithCollab(collab: { role: string } | null): DataContext {
    const DB = {
      prepare(sql: string) {
        return {
          bind(..._args: unknown[]) {
            return {
              async first() {
                if (sql.includes('FROM collaborators')) return collab;
                return null;
              },
            };
          },
        };
      },
    };
    return {
      ...ctxBase,
      env: { ...ctxBase.env, DB: DB as unknown as Env['DB'] },
    };
  }

  const sessionRequest = new Request('https://example.com', {
    headers: { Cookie: 'shareout_session=token123' },
  });

  it('canEditPresentation allows artifact owners', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
    await expect(canEditPresentation(sessionRequest, ctxBase, PRES_ID)).resolves.toBe(true);
  });

  it('canEditPresentation allows editor collaborators', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    vi.spyOn(await import('../../../../src/token'), 'verifySessionToken').mockResolvedValue({
      userId: 'usr_editor',
      email: 'editor@example.com',
    });
    const ctx = makeCtxWithCollab({ role: 'editor' });
    await expect(canEditPresentation(sessionRequest, ctx, PRES_ID)).resolves.toBe(true);
  });

  it('canEditPresentation allows collaborator owner role', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    vi.spyOn(await import('../../../../src/token'), 'verifySessionToken').mockResolvedValue({
      userId: 'usr_coowner',
      email: 'coowner@example.com',
    });
    const ctx = makeCtxWithCollab({ role: 'owner' });
    await expect(canEditPresentation(sessionRequest, ctx, PRES_ID)).resolves.toBe(true);
  });

  it('canEditPresentation denies viewer collaborators', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    vi.spyOn(await import('../../../../src/token'), 'verifySessionToken').mockResolvedValue({
      userId: 'usr_viewer',
      email: 'viewer@example.com',
    });
    const ctx = makeCtxWithCollab({ role: 'viewer' });
    await expect(canEditPresentation(sessionRequest, ctx, PRES_ID)).resolves.toBe(false);
  });

  it('canEditPresentation denies non-collaborators without session', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    await expect(canEditPresentation(new Request('https://example.com'), ctxBase, PRES_ID)).resolves.toBe(false);
  });

  it('canEditPresentation denies non-collaborators with session', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    vi.spyOn(await import('../../../../src/token'), 'verifySessionToken').mockResolvedValue({
      userId: 'usr_stranger',
      email: 'stranger@example.com',
    });
    const ctx = makeCtxWithCollab(null);
    await expect(canEditPresentation(sessionRequest, ctx, PRES_ID)).resolves.toBe(false);
  });

  it('canEditSlide blocks locked slides for non-owners', async () => {
    const lockedSlide = makeSlide({ locked: 1, owner_id: 'usr_slide' });
    const authModule = await import('../../../../src/data/slides/auth');
    vi.spyOn(authModule, 'getSession').mockResolvedValue({ userId: 'usr_other', email: 'other@example.com' });
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);

    await expect(
      canEditSlide(new Request('https://example.com'), ctxBase, PRES_ID, lockedSlide)
    ).resolves.toBe(false);
  });

  it('canEditSlide allows presentation owner on locked slides', async () => {
    const lockedSlide = makeSlide({ locked: 1, owner_id: 'usr_slide' });
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);

    await expect(
      canEditSlide(new Request('https://example.com'), ctxBase, PRES_ID, lockedSlide)
    ).resolves.toBe(true);
  });

  it('canEditSlide allows deck editor on unlocked slides', async () => {
    const unlockedSlide = makeSlide({ locked: 0, owner_id: 'usr_slide' });
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    vi.spyOn(await import('../../../../src/token'), 'verifySessionToken').mockResolvedValue({
      userId: 'usr_editor',
      email: 'editor@example.com',
    });
    const ctx = makeCtxWithCollab({ role: 'editor' });
    await expect(canEditSlide(sessionRequest, ctx, PRES_ID, unlockedSlide)).resolves.toBe(true);
  });

  it('canEditSlide denies deck editor on locked slides owned by someone else', async () => {
    const lockedSlide = makeSlide({ locked: 1, owner_id: 'usr_slide' });
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    vi.spyOn(await import('../../../../src/token'), 'verifySessionToken').mockResolvedValue({
      userId: 'usr_editor',
      email: 'editor@example.com',
    });
    const ctx = makeCtxWithCollab({ role: 'editor' });
    await expect(canEditSlide(sessionRequest, ctx, PRES_ID, lockedSlide)).resolves.toBe(false);
  });
});

