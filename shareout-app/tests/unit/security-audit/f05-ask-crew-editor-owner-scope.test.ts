// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';

const h = vi.hoisted(() => ({ run: vi.fn(), getCrew: vi.fn() }));
vi.mock('../../../src/crew/dispatch', () => ({ runCrewForArtifact: h.run }));
vi.mock('../../../src/crew/store', async (orig) => ({ ...(await orig<typeof import('../../../src/crew/store')>()), getCrew: h.getCrew }));

import { executeAction } from '../../../src/chat-agent/actions';
import { askCrewTool } from '../../../src/chat-agent/tools/actions';

const ART = 'art_f05';
const owner = 'usr_f05_owner';
const editor = 'usr_f05_editor';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email) VALUES (?, 'f05owner@x.test'), (?, 'f05editor@x.test')").bind(owner, editor),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, 'Dash', 'f05', ?, 'private')").bind(ART, owner),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_f05', ?, 'f05editor@x.test', 'editor')").bind(ART),
  ]);
});

beforeEach(() => {
  h.run.mockReset().mockResolvedValue({ ok: true, resultText: 'done' });
  h.getCrew.mockReset().mockResolvedValue({ id: 'crew_1' });
});

const action = { kind: 'crew' as const, artifactId: ART, artifactName: 'Dash', instruction: 'list all rows' };

describe('f05 chat ask_crew is owner-only, like the crew API', () => {
  it('blocks: an editor can neither propose nor execute an owner-scope crew run', async () => {
    const proposed = await askCrewTool.execute({ env: e, userId: editor }, { artifact_id: ART, instruction: 'list all rows' });
    expect(proposed).toMatchObject({ error: expect.stringMatching(/owner/i) });
    expect(await executeAction(e, editor, action)).toMatch(/owner/i);
    expect(h.run).not.toHaveBeenCalled();
  });

  it('the owner can still propose and run it', async () => {
    const proposed = await askCrewTool.execute({ env: e, userId: owner }, { artifact_id: ART, instruction: 'list all rows' });
    expect(proposed).toMatchObject({ __propose: { kind: 'crew' } });
    expect(await executeAction(e, owner, action)).toBe('done');
    expect(h.run).toHaveBeenCalledOnce();
  });
});
