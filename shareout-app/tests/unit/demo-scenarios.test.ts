// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../../src/demo/scenarios';

describe('Showtime scenario catalog (work/044)', () => {
  it('registers one flagship per demo company', () => {
    const byCo = Object.fromEntries(SCENARIOS.map((s) => [s.company, s.name]));
    expect(byCo).toMatchObject({
      terra: 'lanzamiento',
      solara: 'cierre-mensual',
      alameda: 'avance-obra',
      meridiano: 'quiebre-stock',
    });
  });

  it('names are stable API keys (no spaces)', () => {
    for (const s of SCENARIOS) {
      expect(s.name).toMatch(/^[a-z0-9-]+$/);
      expect(s.approxMin).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(5);
    }
  });
});
