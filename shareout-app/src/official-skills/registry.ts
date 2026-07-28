// Curated "Recommended by ShareOut" skills, seeded into every workspace's Skill
// Library and kept fresh by the daily `syncOfficialSkills` cron. Order here is the
// order shown in the Recommended strip. Content lives in ../../official-skills/*.md
// (vendored, committed) and is embedded at build → official-content.generated.ts.
//
// `slug` is the stable identity: the cron dedupes on it, so never renumber/rename a
// live slug. `name`/`summary`/`category` drive the card (they override whatever the
// vendored frontmatter says, so third-party summaries stay on-brand and short).

export interface OfficialSkillDef {
  /** Stable identity + display slug base. URL-safe, never changed once live. */
  slug: string;
  /** Vendored markdown filename under official-skills/. */
  sourceFile: string;
  /** Card title. */
  name: string;
  /** One-line card summary (kept short; overrides frontmatter). */
  summary: string;
  /** Marketplace category. */
  category: string;
  /** Card tags. */
  tags: string[];
  /** Author/source credit for third-party skills; omitted for ShareOut's own. */
  attribution?: string;
}

export const OFFICIAL_SKILLS: OfficialSkillDef[] = [
  {
    slug: 'shareout',
    sourceFile: 'shareout.md',
    name: 'ShareOut',
    summary: 'The canonical ShareOut skill — build, publish, and manage artifacts, data stores, and automation. Always current.',
    category: 'ShareOut',
    tags: ['official', 'artifacts', 'sdk', 'publishing'],
  },
  {
    slug: 'designing-beautiful-websites',
    sourceFile: 'designing-beautiful-websites.md',
    name: 'Designing Beautiful Websites',
    summary: 'UX strategy, information architecture, and polished visual design for websites and web apps.',
    category: 'Design',
    tags: ['design', 'frontend', 'ux'],
    attribution: 'Matt Pocock',
  },
  {
    slug: 'premium-frontend-ui',
    sourceFile: 'premium-frontend-ui.md',
    name: 'Premium Frontend UI',
    summary: 'Craft immersive, high-performance web experiences with advanced motion, typography, and layout.',
    category: 'Design',
    tags: ['frontend', 'motion', 'ui'],
    attribution: 'Matt Pocock',
  },
  {
    slug: 'tdd',
    sourceFile: 'tdd.md',
    name: 'Test-Driven Development',
    summary: 'Build features and fix bugs test-first with the red-green-refactor loop.',
    category: 'Engineering',
    tags: ['testing', 'tdd', 'quality'],
    attribution: 'Matt Pocock',
  },
  {
    slug: 'grilling',
    sourceFile: 'grilling.md',
    name: 'Grilling',
    summary: 'Stress-test a plan or design by interviewing you relentlessly until the design tree is resolved.',
    category: 'Planning',
    tags: ['planning', 'design', 'review'],
    attribution: 'Matt Pocock',
  },
  {
    slug: 'domain-modeling',
    sourceFile: 'domain-modeling.md',
    name: 'Domain Modeling',
    summary: 'Pin down a project’s ubiquitous language and record architectural decisions.',
    category: 'Engineering',
    tags: ['architecture', 'ddd', 'modeling'],
    attribution: 'Matt Pocock',
  },
  {
    slug: 'codebase-design',
    sourceFile: 'codebase-design.md',
    name: 'Codebase Design',
    summary: 'Shared vocabulary for designing deep modules, seams, and testable interfaces.',
    category: 'Engineering',
    tags: ['architecture', 'modules', 'design'],
    attribution: 'Matt Pocock',
  },
  {
    slug: 'design-an-interface',
    sourceFile: 'design-an-interface.md',
    name: 'Design an Interface',
    summary: 'Generate multiple radically different interface designs for a module using parallel agents.',
    category: 'Engineering',
    tags: ['api', 'design', 'interfaces'],
    attribution: 'Matt Pocock',
  },
];

export const OFFICIAL_SKILL_SLUGS = new Set(OFFICIAL_SKILLS.map((s) => s.slug));
