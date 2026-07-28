import { describe, it, expect } from 'vitest';
import {
  renderMetricDefsMarkup,
  renderAlertSummaryMarkup,
  metricsPanelMarkup,
  type MetricDefinitionSummary,
  type AlertRuleSummary,
} from '../src/rail/metrics-panel';

describe('renderMetricDefsMarkup', () => {
  it('shows an empty state hinting at the JSON store', () => {
    const html = renderMetricDefsMarkup([]);
    expect(html).toContain('No followable metrics yet');
    expect(html).not.toContain('connect-list');
  });

  it('lists metrics with id + source type and a remove button', () => {
    const defs: MetricDefinitionSummary[] = [
      { metric_id: 'revenue', label: 'Revenue', source: { type: 'json_path' } },
    ];
    const html = renderMetricDefsMarkup(defs);
    expect(html).toContain('Revenue');
    expect(html).toContain('revenue');
    expect(html).toContain('json_path');
    expect(html).toContain('data-metric-del="revenue"');
  });

  it('escapes metric labels', () => {
    const html = renderMetricDefsMarkup([{ metric_id: 'x', label: 'a<b>"c' }]);
    expect(html).toContain('a&lt;b&gt;&quot;c');
    expect(html).not.toContain('a<b>"c');
  });
});

describe('renderAlertSummaryMarkup', () => {
  it('shows an empty state pointing at the toolbar', () => {
    const html = renderAlertSummaryMarkup([]);
    expect(html).toContain('No alerts yet');
    expect(html).toContain('toolbar');
  });

  it('lists alerts with a delete button and paused marker', () => {
    const alerts: AlertRuleSummary[] = [
      { id: 'al_1', name: 'Rev drop', metric_id: 'revenue', enabled: false },
    ];
    const html = renderAlertSummaryMarkup(alerts);
    expect(html).toContain('Rev drop');
    expect(html).toContain('(paused)');
    expect(html).toContain('data-alert-del="al_1"');
  });

  it('renders a sparkline when an alert has ≥2 history points', () => {
    const withHistory = renderAlertSummaryMarkup([{ id: 'a', name: 'Rev', metric_id: 'revenue', enabled: true, history: [1, 3, 2] }]);
    expect(withHistory).toContain('<svg');
    expect(withHistory).toContain('<polyline');
    const without = renderAlertSummaryMarkup([{ id: 'a', name: 'Rev', metric_id: 'revenue', enabled: true, history: [5] }]);
    expect(without).not.toContain('<svg');
  });
});

describe('metricsPanelMarkup', () => {
  it('renders the add-metric form above the lists', () => {
    const html = metricsPanelMarkup([], []);
    expect(html).toContain('data-metric-id');
    expect(html).toContain('data-metric-label');
    expect(html).toContain('data-metric-key');
    expect(html).toContain('data-metric-path');
    expect(html).toContain('data-metric-add');
    expect(html).toContain('Add a followable metric');
  });
});
