import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareOut, ShareOutError } from '../src/index';

function createSdk() {
  return new ShareOut({ artifactId: 'art_1', baseUrl: 'https://api.example.com' });
}

function fakeRuntime(overrides: Partial<Record<string, unknown>> = {}) {
  const calls = {
    globalsSet: [] as Array<[string, unknown]>,
    globalsDeleted: [] as string[],
    loaded: [] as Array<string | string[]>,
    ran: [] as string[],
    installed: [] as string[][],
  };
  let stdout: ((t: string) => void) | undefined;
  let stderr: ((t: string) => void) | undefined;
  const runtime = {
    globals: {
      set: (k: string, v: unknown) => calls.globalsSet.push([k, v]),
      delete: (k: string) => calls.globalsDeleted.push(k),
    },
    loadPackage: vi.fn(async (names: string | string[]) => { calls.loaded.push(names); }),
    pyimport: () => ({ install: async (pkgs: string[]) => { calls.installed.push(pkgs); } }),
    setStdout: ({ batched }: { batched?: (t: string) => void }) => { stdout = batched; },
    setStderr: ({ batched }: { batched?: (t: string) => void }) => { stderr = batched; },
    runPythonAsync: vi.fn(async (code: string) => {
      calls.ran.push(code);
      stdout?.('hello\n');
      return (overrides.result as unknown) ?? 42;
    }),
  };
  return { runtime, calls, emitStderr: () => stderr?.('boom\n') };
}

function stubBrowser(loadPyodide: unknown) {
  vi.stubGlobal('document', { getElementById: () => null });
  vi.stubGlobal('window', { loadPyodide });
}

afterEach(() => {
  new ShareOut({ artifactId: 'art_1', baseUrl: 'x' }).python.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PythonStore', () => {
  it('runs code, captures stdout, injects then clears globals', async () => {
    const { runtime, calls } = fakeRuntime();
    const loadPyodide = vi.fn(async () => runtime);
    stubBrowser(loadPyodide);

    const onStdout = vi.fn();
    const res = await createSdk().python.run('1+1', {
      globals: { x: 5, fn: () => 1 },
      onStdout,
    });

    expect(res).toEqual({ result: 42, stdout: 'hello\n', stderr: '' });
    expect(onStdout).toHaveBeenCalledWith('hello\n');
    expect(calls.ran).toEqual(['1+1']);
    expect(calls.globalsSet.map(([k]) => k)).toEqual(['x', 'fn']);
    expect(calls.globalsDeleted).toEqual(['x', 'fn']);
  });

  it('loads the runtime once across calls', async () => {
    const { runtime } = fakeRuntime();
    const loadPyodide = vi.fn(async () => runtime);
    stubBrowser(loadPyodide);

    const py = createSdk().python;
    await py.ready();
    await py.run('1');
    await py.run('2');

    expect(loadPyodide).toHaveBeenCalledTimes(1);
  });

  it('loads requested packages once and installs via micropip', async () => {
    const { runtime, calls } = fakeRuntime();
    stubBrowser(vi.fn(async () => runtime));

    const py = createSdk().python;
    await py.run('import numpy', { packages: ['numpy'], install: ['snowflake-foo'] });
    await py.run('import numpy', { packages: ['numpy'], install: ['snowflake-foo'] });

    expect(calls.loaded).toEqual([['numpy'], 'micropip']);
    expect(calls.installed).toEqual([['snowflake-foo']]);
  });

  it('converts PyProxy results to JS', async () => {
    const proxy = { toJs: () => ({ a: 1 }), destroy: vi.fn() };
    const { runtime } = fakeRuntime({ result: proxy });
    stubBrowser(vi.fn(async () => runtime));

    const res = await createSdk().python.run('d');
    expect(res.result).toEqual({ a: 1 });
    expect(proxy.destroy).toHaveBeenCalled();
  });

  it('shims blocked storage in the sandbox, then loads the runtime', async () => {
    const { runtime } = fakeRuntime();
    const loadPyodide = vi.fn(async () => runtime);
    const win: Record<string, unknown> = { loadPyodide };
    for (const key of ['sessionStorage', 'localStorage']) {
      Object.defineProperty(win, key, {
        configurable: true,
        get() { throw new Error('sandboxed: no allow-same-origin'); },
      });
    }
    vi.stubGlobal('document', { getElementById: () => null });
    vi.stubGlobal('window', win);

    await createSdk().python.run('1');

    expect(loadPyodide).toHaveBeenCalledTimes(1);
    const ss = win.sessionStorage as Storage;
    ss.setItem('k', 'v');
    expect(ss.getItem('k')).toBe('v');
    expect((win.localStorage as Storage).getItem('missing')).toBeNull();
  });

  it('throws outside a browser environment', async () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    await expect(createSdk().python.run('1')).rejects.toBeInstanceOf(ShareOutError);
  });
});
