import { describe, it, expect } from 'vitest';
import { deriveStatus, isPromotable } from '../../src/tests/runner';
import { scanPolicy } from '../../src/tests/policy-scanner';
import type { TestResult } from '../../src/tests/types';

const r = (tier: TestResult['tier'], status: TestResult['status']): TestResult =>
  ({ name: `${tier}:${status}`, tier, status });

describe('deriveStatus', () => {
  it('errored dominates failed and passed', () => {
    expect(deriveStatus([r('contract', 'passed'), r('smoke', 'errored'), r('contract', 'failed')])).toBe('errored');
  });
  it('failed when no errors but a failure', () => {
    expect(deriveStatus([r('contract', 'passed'), r('contract', 'failed')])).toBe('failed');
  });
  it('passed when all pass', () => {
    expect(deriveStatus([r('contract', 'passed'), r('policy', 'passed')])).toBe('passed');
  });
  it('empty is passed', () => {
    expect(deriveStatus([])).toBe('passed');
  });
});

describe('isPromotable (policy is advisory, never gates)', () => {
  it('policy failure does NOT block promotion', () => {
    expect(isPromotable([r('policy', 'failed'), r('contract', 'passed')])).toBe(true);
  });
  it('functional failure blocks promotion', () => {
    expect(isPromotable([r('contract', 'failed')])).toBe(false);
  });
  it('functional errored blocks promotion', () => {
    expect(isPromotable([r('smoke', 'errored')])).toBe(false);
  });
  it('all-pass functional is promotable', () => {
    expect(isPromotable([r('smoke', 'passed'), r('contract', 'passed'), r('policy', 'failed')])).toBe(true);
  });
});

describe('scanPolicy', () => {
  it('flags a Stripe-style secret as a failed policy result', () => {
    const out = scanPolicy('<script>const k = "sk_live_abcdef0123456789ABCD";</script>');
    const secret = out.find((x) => x.name.includes('secrets'));
    expect(secret?.status).toBe('failed');
  });
  it('clean HTML passes the secret check', () => {
    const out = scanPolicy('<html><body><h1>hello</h1></body></html>');
    expect(out.find((x) => x.name.includes('secrets'))?.status).toBe('passed');
  });
  it('maps external hosts and never fails on them', () => {
    const out = scanPolicy('<script src="https://evil.example.com/x.js"></script>');
    const hosts = out.find((x) => x.name.includes('External hosts'));
    expect(hosts?.status).toBe('passed');
    expect(hosts?.message).toContain('evil.example.com');
  });
  it('every result carries the policy tier', () => {
    expect(scanPolicy('<html></html>').every((x) => x.tier === 'policy')).toBe(true);
  });
});
