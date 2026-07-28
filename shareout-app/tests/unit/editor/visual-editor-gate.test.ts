import { describe, expect, it, vi } from 'vitest';
import { isVisualEditorRoute, requireVisualEditorEnabled, VISUAL_EDITOR_FEATURE } from '../../../src/editor/visual-editor-gate';
import { SUPERADMIN_EMAILS } from '../../../src/superadmin/recipients';

// The shipped roster is empty by design (a public repo must not grant super-admin to a
// baked-in address), so tests that need one mock the roster import.
const testRoster = vi.hoisted(() => ({
  default: {
    recipients: [{ email: 'admin@example.com', telegramChatId: 555000 }, { email: 'ops@example.com' }],
  },
}));
vi.mock('../../../superadmin-recipients.json', () => testRoster);

const SA = SUPERADMIN_EMAILS[0]!;

function makeEnv(workspace?: Record<string, boolean>) {
  const wsRow = workspace !== undefined ? { feature_flags: JSON.stringify(workspace) } : null;
  const DB = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('FROM workspaces')) return wsRow;
              if (sql.includes('platform_config')) return null;
              return null;
            },
          };
        },
      };
    },
  };
  return { DB } as any;
}

describe('visual editor feature gate', () => {
  it('treats source editor paths as exempt', () => {
    expect(isVisualEditorRoute('')).toBe(true);
    expect(isVisualEditorRoute('draft')).toBe(true);
    expect(isVisualEditorRoute('source')).toBe(false);
    expect(isVisualEditorRoute('source/publish')).toBe(false);
  });

  it('blocks when module.visual_editor is off for the workspace', async () => {
    const env = makeEnv({ [VISUAL_EDITOR_FEATURE]: false });
    const res = await requireVisualEditorEnabled(env, 'wsp_test');
    expect(res?.status).toBe(403);
    const body = await res!.json();
    expect(body.code).toBe('FEATURE_DISABLED');
    expect(body.feature).toBe(VISUAL_EDITOR_FEATURE);
  });

  it('allows when the flag is on or unset', async () => {
    expect(await requireVisualEditorEnabled(makeEnv({ [VISUAL_EDITOR_FEATURE]: true }), 'wsp_test')).toBeNull();
    expect(await requireVisualEditorEnabled(makeEnv({}), 'wsp_test')).toBeNull();
  });

  it('bypasses the workspace flag for a super-admin user', async () => {
    const env = makeEnv({ [VISUAL_EDITOR_FEATURE]: false });
    expect(await requireVisualEditorEnabled(env, 'wsp_test', SA)).toBeNull();
    expect(await requireVisualEditorEnabled(env, 'wsp_test', ` ${SA.toUpperCase()} `)).toBeNull();
  });

  it('still blocks a non-admin user when the flag is off', async () => {
    const env = makeEnv({ [VISUAL_EDITOR_FEATURE]: false });
    const res = await requireVisualEditorEnabled(env, 'wsp_test', 'someone@else.com');
    expect(res?.status).toBe(403);
  });
});
