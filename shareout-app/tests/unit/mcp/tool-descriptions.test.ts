/**
 * Tool descriptions say what a tool does; they do not tell the model how to behave.
 * Connector directories reject descriptions that do, so behavior guidance (language,
 * confirmations, what to do on failure) lives in SERVER_INSTRUCTIONS instead.
 */
import { describe, expect, it } from 'vitest';
import { SERVER_INSTRUCTIONS, listTools } from '../../../src/mcp/tools';

// Imperatives count at the start of a sentence; words like "never learned again" or a
// quoted example ("call it Z") describe and are fine.
const START = '(?:^|[.:;] )';
const BEHAVIOR: Array<[string, RegExp]> = [
  ['addresses the model as "you"', /\byou(r)?\b/i],
  ['tells it what to say to the person', /\b(tell|ask|give|offer) (the person|them)\b/i],
  ['tells it how to answer', new RegExp(`${START}(Answer|Say|Cite|Quote|Reply|Tell|Ask) `)],
  ['tells it what to do next', new RegExp(`${START}(Afterwards|Before calling|Confirm|Call|Then) `)],
  ['orders or forbids', new RegExp(`${START}(Never|Always|Do not|Don't|You must) `)],
  ['names the failure tool', /\bcall report_problem\b/],
];

describe('MCP tool descriptions', () => {
  it('describe the tool and carry no instructions for the model', () => {
    const tools = listTools();
    expect(tools.length).toBeGreaterThan(30);
    const found: string[] = [];
    for (const t of tools) {
      for (const [what, re] of BEHAVIOR) {
        const m = re.exec(t.description);
        if (m) found.push(`${t.name}: ${what} ("${t.description.slice(Math.max(0, m.index - 30), m.index + 50)}")`);
      }
    }
    expect(found).toEqual([]);
  });

  it('every tool has a title and a read-only or destructive hint', () => {
    for (const t of listTools()) {
      expect(t.title, t.name).toBeTruthy();
      expect(typeof t.annotations.readOnlyHint === 'boolean' || typeof t.annotations.destructiveHint === 'boolean', t.name).toBe(true);
      expect(t.name.length, t.name).toBeLessThanOrEqual(64);
    }
  });

  it('the server instructions keep the guidance the descriptions used to repeat', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/language they use/);
    expect(SERVER_INSTRUCTIONS).toMatch(/report_problem/);
    expect(SERVER_INSTRUCTIONS).toMatch(/where each fact comes from/);
    expect(SERVER_INSTRUCTIONS).toMatch(/which connector the answer came from/);
    expect(SERVER_INSTRUCTIONS).toMatch(/Confirm with the person before/);
  });
});
