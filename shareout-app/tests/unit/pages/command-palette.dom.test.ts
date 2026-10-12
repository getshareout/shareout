// @vitest-environment happy-dom
//
// Cmd+K ordering (C6): a typed query lists the real matches first so Enter opens the
// top artifact; "Ask AI" is an explicit opt-in that always comes last.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_command_palette_JS as paletteJs } from '../../../src/pages/home/render-workspace/client-script/command-palette';
import { SHELL_COPY } from '../../../src/pages/home/home-i18n/copy/shell';

const copy = SHELL_COPY.es as Record<string, string>;
const openArtifact = vi.fn();
let fetchMock: ReturnType<typeof vi.fn>;

const RESULTS = {
  artifacts: [{ kind: 'artifact', id: 'art_g', title: 'Glosario', slug: 'glosario', score: 1 }],
  folders: [], datasets: [], connectors: [], people: [], schedules: [], crew: [], alerts: [],
};

function boot() {
  const win = globalThis.window as unknown as Record<string, unknown>;
  const scope = new Proxy({}, {
    has: () => true,
    get: (target: Record<string | symbol, unknown>, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'window') return win;
      if (prop === 't') return (k: string) => copy[k] ?? k;
      if (prop === 'esc') return (s: unknown) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      if (prop === 'openArtifact') return openArtifact;
      if (prop === 'fetch') return (...a: unknown[]) => fetchMock(...a);
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
  });
  new Function('scope', `with (scope) {\n${paletteJs}\n}`)(scope);
  return win.openCommandPalette as () => void;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function typeQuery(q: string) {
  const input = document.querySelector<HTMLInputElement>('.wsx-cmdk__input')!;
  input.value = q;
  input.dispatchEvent(new Event('input'));
  await wait(200);
  return input;
}

describe('command palette ordering', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    openArtifact.mockReset();
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith('/v1/ask')) throw new Error('AI must not be called');
      return new Response(JSON.stringify(RESULTS), { headers: { 'Content-Type': 'application/json' } });
    });
  });

  it('puts the matching artifact first and the AI row last', async () => {
    boot()();
    await typeQuery('glosario');
    const rows = [...document.querySelectorAll('.wsx-cmdk__list [data-pi]')];
    expect(rows[0].className).toContain('wsx-cmdk__item--artifact');
    expect(rows[0].classList.contains('is-sel')).toBe(true);
    const last = rows[rows.length - 1];
    expect(last.className).toContain('wsx-cmdk__item--ask');
    expect(last.textContent).toBe('Preguntarle a la IA: «glosario»');
  });

  it('Enter opens the top artifact instead of asking the AI', async () => {
    boot()();
    const input = await typeQuery('glosario');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(openArtifact).toHaveBeenCalledWith('glosario', 'Glosario', 'art_g');
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/v1/ask'))).toBe(false);
  });

  it('keeps the AI row last even for a question', async () => {
    boot()();
    await typeQuery('glosario?');
    const rows = [...document.querySelectorAll('.wsx-cmdk__list [data-pi]')];
    expect(rows[0].className).toContain('wsx-cmdk__item--artifact');
    expect(rows[rows.length - 1].className).toContain('wsx-cmdk__item--ask');
  });
});
