// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderRecentActivity } from '../../src/pages/home/render-cards';

describe('renderRecentActivity (lazy Activity panel)', () => {
  it('renders an empty state when there is no activity', () => {
    const html = renderRecentActivity([]);
    expect(html).toContain('detail-empty');
    expect(html).not.toContain('activity-row');
  });

  it('renders an activity table and escapes artifact names', () => {
    const html = renderRecentActivity([
      { artifact_name: '<b>Sales</b>', slug: 's', event_type: 'view', timestamp: new Date().toISOString(), country: 'AR' },
    ]);
    expect(html).toContain('activity-table');
    expect(html).toContain('activity-row');
    expect(html).toContain('&lt;b&gt;Sales&lt;/b&gt;');
    expect(html).toContain('AR');
    expect(html).toContain('just now');
  });

  it('parses unix-seconds timestamps (not 20000d ago)', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const html = renderRecentActivity([
      { artifact_name: 'X', slug: 'x', event_type: 'view', timestamp: String(nowSec) as unknown as string, country: null },
    ]);
    expect(html).toContain('just now');
    expect(html).not.toMatch(/\d{4,}d ago/);
  });
});
