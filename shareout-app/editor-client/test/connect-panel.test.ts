import { describe, it, expect } from 'vitest';
import { renderConnectionsMarkup, connectPanelMarkup, type ConnectionSummary } from '../src/rail/connect-panel';

describe('renderConnectionsMarkup (EDIT-08 Stage B)', () => {
  it('shows an empty state when there are no connections', () => {
    const html = renderConnectionsMarkup([]);
    expect(html).toContain('No connections yet');
    expect(html).not.toContain('connect-list');
  });

  it('lists connections with friendly type labels and scope', () => {
    const conns: ConnectionSummary[] = [
      { name: 'sales_api', type: 'rest_api', scope: 'artifact' },
      { name: 'warehouse', type: 'snowflake', scope: 'workspace' },
    ];
    const html = renderConnectionsMarkup(conns);
    expect(html).toContain('connect-list');
    expect(html).toContain('sales_api');
    expect(html).toContain('REST API'); // rest_api → friendly label
    expect(html).toContain('warehouse');
    expect(html).toContain('Snowflake');
    expect(html).toContain('This page'); // artifact scope
    expect(html).toContain('Workspace'); // workspace scope
  });

  it('falls back to the raw type for unknown kinds and escapes names', () => {
    const html = renderConnectionsMarkup([{ name: 'a<b>"c', type: 'mystery', scope: 'artifact' }]);
    expect(html).toContain('mystery');
    expect(html).toContain('a&lt;b&gt;&quot;c');
    expect(html).not.toContain('a<b>"c');
  });
});

describe('connectPanelMarkup (add form + list)', () => {
  it('renders the REST add form (name / base URL / token / button) above the list', () => {
    const html = connectPanelMarkup([]);
    expect(html).toContain('data-conn-name');
    expect(html).toContain('data-conn-url');
    expect(html).toContain('data-conn-key');
    expect(html).toContain('data-conn-add');
    expect(html).toContain('Add a REST connection');
    // and the (empty) list state below it
    expect(html).toContain('No connections yet');
  });

  it('includes existing connections under the form', () => {
    const html = connectPanelMarkup([{ name: 'sales_api', type: 'rest_api', scope: 'artifact' }]);
    expect(html).toContain('data-conn-add'); // form still present
    expect(html).toContain('sales_api'); // plus the listed connection
  });
});
