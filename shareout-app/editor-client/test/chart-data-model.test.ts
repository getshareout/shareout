// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  getChartDataBinding,
  setChartDataBinding,
  parseChartConfig,
  writeChartConfig,
  migrateLegacyDataBinding,
} from '../src/charts/chart-data-model';

function chart(attrs = ''): Element {
  const host = document.createElement('div');
  host.innerHTML = `<div data-shareout-chart='{"type":"bar"}' ${attrs}></div>`;
  return host.firstElementChild!;
}

describe('get/setChartDataBinding (flat attrs)', () => {
  it('round-trips source/x/y/filter', () => {
    const el = chart();
    setChartDataBinding(el, { source: 'table:tasks', x: 'day', y: ['count', 'sum'], filter: 'status=open' });
    expect(getChartDataBinding(el)).toEqual({
      source: 'table:tasks',
      x: 'day',
      y: ['count', 'sum'],
      filter: 'status=open',
    });
  });

  it('removes attrs when cleared and only touches provided keys', () => {
    const el = chart('data-shareout-chart-data="table:t" data-shareout-chart-x="a" data-shareout-chart-y="b"');
    setChartDataBinding(el, { x: null });
    expect(el.hasAttribute('data-shareout-chart-x')).toBe(false);
    expect(el.getAttribute('data-shareout-chart-data')).toBe('table:t'); // untouched
    setChartDataBinding(el, { y: [] });
    expect(el.hasAttribute('data-shareout-chart-y')).toBe(false);
  });
});

describe('parse/writeChartConfig', () => {
  it('parses, tolerates malformed JSON, and round-trips', () => {
    expect(parseChartConfig(chart())).toEqual({ type: 'bar' });

    const host = document.createElement('div');
    host.innerHTML = `<div data-shareout-chart="{bad"></div>`;
    expect(parseChartConfig(host.firstElementChild!)).toEqual({});

    const el = chart();
    writeChartConfig(el, { type: 'line', title: 'X' });
    expect(parseChartConfig(el)).toEqual({ type: 'line', title: 'X' });
  });
});

describe('migrateLegacyDataBinding', () => {
  it('is a no-op without a legacy dataBinding', () => {
    const el = chart();
    const { config, migrated } = migrateLegacyDataBinding({ type: 'bar' }, el);
    expect(migrated).toBe(false);
    expect(config).toEqual({ type: 'bar' });
  });

  it('moves a table binding onto the flat attrs and strips dataBinding', () => {
    const el = chart();
    const { config, migrated } = migrateLegacyDataBinding(
      { type: 'bar', dataBinding: { source: 'table', tableName: 'tasks', xColumn: 'day', yColumns: ['count'] } },
      el,
    );
    expect(migrated).toBe(true);
    expect(config).toEqual({ type: 'bar' });
    expect(getChartDataBinding(el)).toMatchObject({ source: 'table:tasks', x: 'day', y: ['count'] });
  });

  it('moves a json binding and handles manual (strip only)', () => {
    const jsonEl = chart();
    migrateLegacyDataBinding({ dataBinding: { source: 'json', jsonKey: 'rows' } }, jsonEl);
    expect(getChartDataBinding(jsonEl).source).toBe('json:rows');

    const manualEl = chart();
    const { config, migrated } = migrateLegacyDataBinding({ series: [], dataBinding: { source: 'manual' } }, manualEl);
    expect(migrated).toBe(true);
    expect(config).toEqual({ series: [] });
    expect(getChartDataBinding(manualEl).source).toBeNull();
  });

  it('keeps existing flat attrs authoritative when both representations exist', () => {
    const el = chart('data-shareout-chart-data="table:real"');
    migrateLegacyDataBinding({ dataBinding: { source: 'table', tableName: 'stale' } }, el);
    expect(getChartDataBinding(el).source).toBe('table:real'); // not overwritten by the legacy value
  });
});
