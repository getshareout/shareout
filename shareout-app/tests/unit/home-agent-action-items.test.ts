// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { actionItemsBlock } from '../../src/router/api/home-agent';
import type { ActionItem } from '../../src/pages/home/types';

function item(over: Partial<ActionItem>): ActionItem {
  return {
    id: 'c1', artifact_id: 'a1', artifact_name: 'Q3 Report', slug: 'q3', actor: 'Ana',
    summary: 'wire up the chart', due_at: null, ts: 0, resolved: 0, resolved_by: null, resolved_at: null,
    ...over,
  };
}

describe('actionItemsBlock (home agent context)', () => {
  it('is empty when there are no open items', () => {
    expect(actionItemsBlock([])).toBe('');
    expect(actionItemsBlock([item({ resolved: 1 })])).toBe('');
  });

  it('summarizes open items with artifact name, due date, and overdue count', () => {
    const past = new Date(Date.now() - 86400_000).toISOString();
    const block = actionItemsBlock([
      item({ id: 'c1', due_at: past }),
      item({ id: 'c2', artifact_name: 'Deck', summary: 'add slide', due_at: null }),
      item({ id: 'c3', resolved: 1 }), // just-completed → excluded
    ]);
    expect(block).toContain('Action items (2 open, 1 overdue):');
    expect(block).toContain('wire up the chart on "Q3 Report" (due ' + past.slice(0, 10) + ')');
    expect(block).toContain('add slide on "Deck"');
  });
});
