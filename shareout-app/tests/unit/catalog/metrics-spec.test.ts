// The metric spec as an agency writes it: the brief's ROAS example must validate as is,
// and every mistake must come back as an error that says what to write instead.
import { describe, expect, it } from 'vitest';
import { extractFrontmatter } from '../../../src/catalog/parse';
import { freshnessMs, metricFormula, metricWriteIssue, validateMetricSpec } from '../../../src/catalog/metrics/spec';

const ROAS = `---
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
scope_field: client_id
freshness_sla: 26h
examples: [{ es: "ROAS de marzo por canal", query: { grain: month, by: [canal], from: 2026-03-01, to: 2026-03-31 } }]
---

Return on ad spend across paid channels.`;

const data = (raw: string) => extractFrontmatter(raw)!.data;
const edit = (from: string, to: string) => data(ROAS.replace(from, to));

describe('validateMetricSpec', () => {
  it('accepts the ROAS spec from the brief', () => {
    const r = validateMetricSpec(data(ROAS));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec).toMatchObject({
      id: 'metric.roas',
      type: 'ratio',
      source: { kind: 'fqn', connection: 'conn_7f2', fqn: 'analytics.ads_daily' },
      time: { dimension: 'date', grains: ['day', 'week', 'month'] },
      dimensions: [{ name: 'cliente', column: 'client_id' }, { name: 'canal', column: 'channel' }],
      format: { kind: 'ratio', decimals: 2, suffix: 'x' },
      examples: [{ es: 'ROAS de marzo por canal', query: { grain: 'month', by: ['canal'], from: '2026-03-01', to: '2026-03-31' } }],
    });
    expect(metricFormula(r.spec)).toBe('Σ revenue ÷ Σ spend');
  });

  it('refuses an unknown key and names the one it most likely meant', () => {
    expect(validateMetricSpec(edit('numerator:', 'numerador:'))).toMatchObject({
      ok: false,
      issue: { param: 'numerador', message: expect.stringContaining('Did you mean "numerator"?') },
    });
    expect(validateMetricSpec(edit('dimensions:', 'dimension:'))).toMatchObject({ ok: false, issue: { message: expect.stringContaining('"dimensions"') } });
    expect(validateMetricSpec(edit('agg: sum, expr: revenue', 'agg: sum, expr: revenue, round: 2'))).toMatchObject({
      ok: false,
      issue: { param: 'numerator.round', hint: 'Allowed in numerator: agg, expr.' },
    });
    expect(validateMetricSpec(edit('kind: ratio, decimals', 'kind: ratio, decimales: 2, decimals'))).toMatchObject({
      ok: false,
      issue: { param: 'format.decimales', message: expect.stringContaining('"decimals"') },
    });
  });

  it('keeps the data location under source:', () => {
    expect(validateMetricSpec(edit('owner:', 'connection: conn_7f2\nowner:'))).toMatchObject({ ok: false, issue: { param: 'connection', hint: expect.stringContaining('source:') } });
    expect(validateMetricSpec(edit('connection: conn_7f2', 'connection: Meta Ads'))).toMatchObject({
      ok: false,
      issue: { param: 'source.connection', message: expect.stringContaining('connection id'), hint: expect.stringContaining('GET /v1/workspaces/{id}/connections') },
    });
    expect(validateMetricSpec(edit('fqn: analytics.ads_daily', 'fqn: analytics.ads_daily, sql: "SELECT 1"'))).toMatchObject({ ok: false, issue: { param: 'source' } });
    const shared = validateMetricSpec(edit('{ connection: conn_7f2, fqn: analytics.ads_daily }', '{ shared_table: ads_daily }'));
    expect(shared).toMatchObject({ ok: true, spec: { source: { kind: 'shared_table', shared_table: 'ads_daily' } } });
  });

  it('checks the shape of each type', () => {
    expect(validateMetricSpec(edit('type: ratio', 'type: simple'))).toMatchObject({ ok: false, issue: { param: 'type' } });
    expect(validateMetricSpec(edit('type: ratio', 'type: average'))).toMatchObject({ ok: false, issue: { message: 'type must be one of: simple, ratio' } });
    expect(validateMetricSpec(edit('agg: sum, expr: spend', 'agg: median, expr: spend'))).toMatchObject({ ok: false, issue: { param: 'denominator.agg' } });
    expect(validateMetricSpec(edit('expr: revenue', 'expr: "*"'))).toMatchObject({ ok: false, issue: { param: 'numerator.expr' } });
  });

  it('only accepts plain column names on a warehouse, and JSON keys (accents, spaces) on a shared table', () => {
    expect(validateMetricSpec(edit('column: channel', 'column: "channel; drop"'))).toMatchObject({ ok: false, issue: { param: 'dimensions[1].column' } });
    expect(validateMetricSpec(edit('column: channel', 'column: Canal de venta'))).toMatchObject({ ok: false });
    const shared = ROAS.replace('{ connection: conn_7f2, fqn: analytics.ads_daily }', '{ shared_table: ads_daily }').replace('column: channel', 'column: Canal de venta').replace('expr: spend', 'expr: Inversión');
    expect(validateMetricSpec(data(shared))).toMatchObject({ ok: true });
    expect(validateMetricSpec(edit('name: canal', 'name: value'))).toMatchObject({ ok: false, issue: { param: 'dimensions[1].name' } });
  });

  it('checks filters, format, freshness and examples', () => {
    expect(validateMetricSpec(edit(`["status = 'active'"]`, `["status = 'active'; DROP TABLE x"]`))).toMatchObject({ ok: false, issue: { param: 'filters[0]' } });
    expect(validateMetricSpec(edit(`["status = 'active'"]`, `["status = 'active' -- note"]`))).toMatchObject({ ok: false, issue: { param: 'filters[0]' } });
    expect(validateMetricSpec(edit('kind: ratio, decimals: 2, suffix: "x"', 'kind: currency'))).toMatchObject({ ok: false, issue: { param: 'format.currency' } });
    expect(validateMetricSpec(edit('kind: ratio, decimals: 2, suffix: "x"', 'kind: currency, currency: ARS'))).toMatchObject({ ok: true, spec: { format: { kind: 'currency', currency: 'ARS' } } });
    expect(validateMetricSpec(edit('freshness_sla: 26h', 'freshness_sla: soon'))).toMatchObject({ ok: false, issue: { param: 'freshness_sla' } });
    expect(validateMetricSpec(edit('by: [canal]', 'by: [region]'))).toMatchObject({ ok: false, issue: { param: 'examples[0].query.by', hint: 'Dimensions: cliente, canal.' } });
    expect(validateMetricSpec(edit('grain: month', 'grain: year'))).toMatchObject({ ok: false, issue: { param: 'examples[0].query.grain' } });
    expect(freshnessMs('26h')).toBe(26 * 3_600_000);
  });
});

describe('metricWriteIssue — what PUT refuses', () => {
  it('refuses an invalid executable metric with the issue', () => {
    expect(metricWriteIssue('metrics/roas.md', ROAS.replace('numerator:', 'numerador:'))).toMatchObject({ param: 'numerador' });
    expect(metricWriteIssue('metrics/roas.md', ROAS)).toBeNull();
  });

  it('leaves descriptive metrics, other kinds and non-markdown alone', () => {
    expect(metricWriteIssue('metrics/m.md', '---\nkind: metric\nid: m\ntitle: M\ncustom: 1\n---\nJust prose.')).toBeNull();
    expect(metricWriteIssue('tables/t.md', '---\nkind: table\nid: t\ntitle: T\nnumerador: 1\n---')).toBeNull();
    expect(metricWriteIssue('metrics/roas.yaml', 'kind: metric')).toBeNull();
  });
});
