import { describe, expect, it } from 'vitest';
import companyTs from '../../../src/pages/company.ts?raw';
import statusTs from '../../../src/pages/status.ts?raw';
import knowledgeTs from '../../../src/pages/home/render-workspace/client-script/home-views/knowledge.ts?raw';
import clientsTs from '../../../src/pages/home/render-workspace/client-script/home-views/clients.ts?raw';

describe('OSS frontend polish — no dead billing/pricing links', () => {
  it('knowledge lens does not link to /app/billing', () => {
    expect(knowledgeTs).not.toContain('/app/billing');
  });

  it('terms page does not link to /pricing', () => {
    expect(companyTs).not.toContain('href="/pricing"');
  });

  it('clients admin view toasts on network failure', () => {
    expect(clientsTs).toContain('function clientNetFail');
    expect(clientsTs).toContain("showToast(t('admin.actionFailed'), 'error')");
  });

  it('status page uses feedback color CSS vars', () => {
    expect(statusTs).toContain('var(--color-success)');
    expect(statusTs).toContain('var(--color-warning)');
    expect(statusTs).not.toMatch(/#16a34a|#ca8a04|#15803d|#a16207/i);
  });
});
