// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { skillDescription, toAgentSkillMarkdown, toSkillName } from '../../../src/skills/markdown';

describe('toSkillName', () => {
  it('slugs a display name to the Agent Skills shape', () => {
    expect(toSkillName('Brand Guidelines!')).toBe('brand-guidelines');
    expect(toSkillName('  Deploy   checklist  ')).toBe('deploy-checklist');
    expect(toSkillName('Ya está 2026')).toBe('ya-est-2026');
  });

  it('never emits an empty or trailing-hyphen name', () => {
    expect(toSkillName('!!!')).toBe('skill');
    expect(toSkillName('')).toBe('skill');
    expect(toSkillName('x'.repeat(80)).length).toBeLessThanOrEqual(64);
    expect(toSkillName(`${'a'.repeat(63)}-bbb`).endsWith('-')).toBe(false);
  });
});

describe('toAgentSkillMarkdown', () => {
  const skill = { slug: 'brand-guidelines', name: 'Brand guidelines', summary: 'How we brand dashboards' };

  it('writes name and description, which is what a client actually reads', () => {
    const out = toAgentSkillMarkdown(skill, '# Brand\n\nBody.\n');
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toContain('name: brand-guidelines');
    expect(out).toContain('description: How we brand dashboards');
  });

  it('replaces the legacy `summary:` key our own docs recommended', () => {
    const src = '---\nsummary: How we brand dashboards\ncategory: Design\n---\n\n# Brand\n';
    const out = toAgentSkillMarkdown(skill, src);
    expect(out).toContain('description: How we brand dashboards');
    expect(out).not.toContain('summary:');
    expect(out).toContain('category: Design');
  });

  it('keeps every other frontmatter key, including list forms', () => {
    const src = '---\nname: whatever\ncategory: Design\ntags:\n  - ui\n  - branding\nversion: 1.2.0\n---\n\n# Brand\n';
    const out = toAgentSkillMarkdown(skill, src);
    expect(out).toContain('category: Design');
    expect(out).toContain('  - ui');
    expect(out).toContain('version: 1.2.0');
    // The author's own `name` is replaced by the slug-derived one, not duplicated.
    expect(out.match(/^name:/gm)).toHaveLength(1);
    expect(out).toContain('name: brand-guidelines');
  });

  it('keeps the body intact and unescaped', () => {
    const body = '# Brand\n\nUse `so.json()` and **bold**.\n\n```js\nconst a = 1;\n```\n';
    const out = toAgentSkillMarkdown(skill, `---\nsummary: s\n---\n\n${body}`);
    expect(out.endsWith(body)).toBe(true);
  });

  it('falls back to the display name when there is no summary', () => {
    const out = toAgentSkillMarkdown({ slug: 'x', name: 'Deploy checklist' }, '# X\n');
    expect(out).toContain('description: Deploy checklist');
  });

  it('quotes a description that YAML would otherwise misread', () => {
    const out = toAgentSkillMarkdown({ slug: 'x', name: 'X', summary: 'a: b #c' }, '# X\n');
    expect(out).toContain('description: "a: b #c"');
  });
});

describe('skillDescription', () => {
  it('collapses whitespace and falls back to the name', () => {
    expect(skillDescription('Deploy', '  many\n  lines  ')).toBe('many lines');
    expect(skillDescription('Deploy', '')).toBe('Deploy');
    expect(skillDescription('Deploy', null)).toBe('Deploy');
  });

  it('caps the description so an index entry cannot run away', () => {
    expect(skillDescription('X', 'a'.repeat(2000)).length).toBe(1024);
  });
});
