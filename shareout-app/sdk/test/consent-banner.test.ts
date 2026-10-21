import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/stores/connection';
import { ConsentRequiredError } from '../src/shareout-error';
import { _resetConsentBanners } from '../src/internal/consent-banner';
import type { SdkClient } from '../src/core/sdk-client';

function fakeDom() {
  const appended: Array<Record<string, unknown>> = [];
  const el = () => {
    const attrs: Record<string, string> = {};
    const node: Record<string, unknown> = {
      style: {}, attrs, children: [] as unknown[],
      setAttribute: (k: string, v: string) => { attrs[k] = v; },
      append(...c: unknown[]) { (node.children as unknown[]).push(...c); },
    };
    return node;
  };
  vi.stubGlobal('document', { body: { appendChild: (n: Record<string, unknown>) => appended.push(n) }, createElement: el });
  return appended;
}

const consentError = () => new ConsentRequiredError('Approve', 403, 'https://shareout.test/connect-consent?artifact=a&connection=crm');
const sdk = (fn: () => Promise<unknown>) => ({ _internalFetch: vi.fn(fn) }) as unknown as SdkClient;

beforeEach(() => _resetConsentBanners());
afterEach(() => vi.unstubAllGlobals());

describe('consent banner', () => {
  it('shows one Allow link per connection and still throws the typed error', async () => {
    const appended = fakeDom();
    const conn = new Connection(sdk(() => Promise.reject(consentError())), 'crm');
    await expect(conn.query('x')).rejects.toBeInstanceOf(ConsentRequiredError);
    await expect(conn.materialize({ rows: [], to: 'json:k' })).rejects.toBeInstanceOf(ConsentRequiredError);
    expect(appended).toHaveLength(1);
    const link = (appended[0].children as Array<Record<string, unknown>>)[1];
    expect(link.href).toBe('https://shareout.test/connect-consent?artifact=a&connection=crm');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener');
    expect((appended[0].children as Array<Record<string, unknown>>)[0].textContent).toContain('crm');
  });

  it('does not show a banner for other errors and a retry after approval just works', async () => {
    const appended = fakeDom();
    let approved = false;
    const conn = new Connection(sdk(async () => {
      if (!approved) throw consentError();
      return { data: 1, cached: false, executionTimeMs: 1 };
    }), 'crm');
    await expect(conn.query('x')).rejects.toBeInstanceOf(ConsentRequiredError);
    approved = true;
    await expect(conn.query('x')).resolves.toMatchObject({ data: 1 });
    expect(appended).toHaveLength(1);

    _resetConsentBanners();
    appended.length = 0;
    const failing = new Connection(sdk(() => Promise.reject(new Error('boom'))), 'crm');
    await expect(failing.query('x')).rejects.toThrow('boom');
    expect(appended).toHaveLength(0);
  });
});
