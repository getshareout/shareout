// Certification is pinned to one version of an entry: these cover what counts as "the
// same version" (hash normalization) and how decisions resolve to an effective status.
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  certificationHash,
  effectiveStatus,
  resolveCertification,
} from '../../../src/catalog/certification';
import { parseEntry } from '../../../src/catalog/parse';
import type { CertDecision, CertificationRecord } from '../../../src/catalog/types';

const METRIC = `---
kind: metric
id: metric.roas
title: ROAS
title_es: Retorno de la inversión publicitaria
owner: ana@agencia.example
synonyms: { es: [retorno publicitario], en: [return on ad spend] }
description: { es: Ingresos atribuidos ÷ inversión, en: Attributed revenue ÷ ad spend }
source: { connection: conn_7f2, fqn: analytics.ads_daily }
type: ratio
numerator: { agg: sum, expr: revenue }
denominator: { agg: sum, expr: spend }
time: { dimension: date, grains: [day, week, month] }
dimensions: [{ name: cliente, column: client_id }, { name: canal, column: channel }]
filters: ["status = 'active'"]
format: { kind: ratio, decimals: 2, suffix: "x" }
---

Notes for humans.`;

const hash = (kind: string, raw: string) => certificationHash(kind, raw);

describe('certification hash — metrics hash the normalized spec only', () => {
  it('ignores prose: description, synonyms, examples, owner, tags and the body', async () => {
    const base = await hash('metric', METRIC);
    const prose = METRIC.replace('Attributed revenue ÷ ad spend', 'Revenue we can attribute, over spend')
      .replace('owner: ana@agencia.example', 'owner: luis@agencia.example\ntags: [tier.gold]')
      .replace('[retorno publicitario]', '[retorno publicitario, roas]')
      .replace('Notes for humans.', 'Rewritten notes, with an example query.');
    expect(await hash('metric', prose)).toBe(base);
  });

  it('ignores key order, YAML style, comments and blank optional fields', async () => {
    const base = await hash('metric', METRIC);
    const restyled = METRIC.replace(
      'numerator: { agg: sum, expr: revenue }',
      'numerator:\n  expr: revenue   # gross\n  agg: sum'
    ).replace('type: ratio', 'type: "ratio"\nscope_field:');
    expect(await hash('metric', restyled)).toBe(base);
  });

  it('changes when what the metric computes or shows changes', async () => {
    const base = await hash('metric', METRIC);
    for (const edit of [
      METRIC.replace('expr: revenue', 'expr: gross_revenue'),
      METRIC.replace("status = 'active'", "status = 'paused'"),
      METRIC.replace('decimals: 2', 'decimals: 1'),
      METRIC.replace('title: ROAS', 'title: Return'),
      METRIC.replace('grains: [day, week, month]', 'grains: [month]'),
      METRIC.replace('fqn: analytics.ads_daily', 'fqn: analytics.ads_hourly'),
    ]) {
      expect(await hash('metric', edit)).not.toBe(base);
    }
  });

  it('keeps dimension order significant (it is the display order)', () => {
    expect(canonicalJson({ d: ['a', 'b'] })).not.toBe(canonicalJson({ d: ['b', 'a'] }));
    expect(canonicalJson({ b: 1, a: { y: ' x ', z: null } })).toBe('{"a":{"y":"x"},"b":1}');
  });
});

describe('certification hash — other kinds hash the whole file', () => {
  const TABLE = '---\nkind: table\nid: t.orders\ntitle: Orders\n---\n\nOne row per order.\n';

  it('normalizes line endings and trailing whitespace only', async () => {
    const base = await hash('table', TABLE);
    expect(await hash('table', TABLE.replace(/\n/g, '\r\n'))).toBe(base);
    expect(await hash('table', TABLE.replace('Orders\n', 'Orders   \n') + '\n\n')).toBe(base);
    expect(await hash('table', '\uFEFF' + TABLE)).toBe(base);
  });

  it('changes on any prose edit', async () => {
    expect(await hash('table', TABLE.replace('One row', 'Exactly one row'))).not.toBe(await hash('table', TABLE));
  });
});

let seq = 0;
function rec(decision: CertDecision, contentHash: string): CertificationRecord {
  seq += 1;
  return {
    id: `ccert_${seq}`,
    entry_id: 'e1',
    content_hash: contentHash,
    decision,
    note: null,
    decided_by: { id: 'usr_admin', name: 'Ana', email: 'ana@agencia.example' },
    decided_at: new Date(Date.UTC(2026, 9, 1, 0, seq)).toISOString(),
  };
}

describe('resolveCertification — effective status', () => {
  it('a status: certified line in the file never certifies', () => {
    expect(resolveCertification('certified', 'h1', [])).toMatchObject({ status: 'draft', declared_status: 'certified', stale: false, decision: null });
  });

  it('a file may declare itself deprecated', () => {
    expect(resolveCertification('deprecated', 'h1', []).status).toBe('deprecated');
  });

  it('certified while the hash matches; changed since certification once it does not', () => {
    const c = rec('certified', 'h1');
    expect(resolveCertification(undefined, 'h1', [c])).toMatchObject({ status: 'certified', stale: false, decision: c });
    expect(resolveCertification(undefined, 'h2', [c])).toMatchObject({ status: 'draft', stale: true, decision: c });
  });

  it('reverting to a certified version restores it, unless a revoke came after', () => {
    const c1 = rec('certified', 'h1');
    const c2 = rec('certified', 'h2');
    expect(resolveCertification(undefined, 'h1', [c1, c2])).toMatchObject({ status: 'certified', decision: c1 });
    const revoked = rec('revoked', 'h2');
    const c3 = rec('certified', 'h3');
    // h1 was certified, then the entry was revoked: going back to h1 does not bring it back.
    expect(resolveCertification(undefined, 'h1', [c1, revoked, c3])).toMatchObject({ status: 'draft', stale: true, decision: c3 });
  });

  it('a revoke returns the entry to draft', () => {
    const r = rec('revoked', 'h1');
    expect(resolveCertification('certified', 'h1', [rec('certified', 'h1'), r])).toMatchObject({ status: 'draft', stale: false, decision: r });
  });

  it('a deprecation sticks across edits and says it changed since', () => {
    const d = rec('deprecated', 'h1');
    expect(resolveCertification(undefined, 'h1', [rec('certified', 'h1'), d])).toMatchObject({ status: 'deprecated', stale: false });
    expect(resolveCertification(undefined, 'h2', [d])).toMatchObject({ status: 'deprecated', stale: true, decision: d });
  });

  it('effectiveStatus reads the overlay, and never trusts a raw declared certified', () => {
    const raw = parseEntry('x.md', '---\nkind: table\nid: x\ntitle: X\nstatus: certified\n---').entry!;
    expect(effectiveStatus(raw)).toBe('draft');
    expect(effectiveStatus({ ...raw, certification: resolveCertification('certified', 'h', [rec('certified', 'h')]) })).toBe('certified');
  });
});
