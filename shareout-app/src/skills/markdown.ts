/**
 * Turn a stored skill into a file an external agent can actually load.
 *
 * ShareOut's own docs told authors to write `summary:` in the frontmatter, but the
 * Agent Skills convention every client reads (Claude Code's `~/.claude/skills/`, and
 * the `.well-known/agent-skills` index this Worker already serves) keys off `name`
 * and `description`. A skill written to our docs downloaded verbatim therefore did
 * not register anywhere — the one thing the download exists to do.
 *
 * So the bytes we hand out are normalized rather than raw: `name` is derived from the
 * slug, `description` from the summary (accepting `summary` as the legacy spelling),
 * and every other key the author wrote is preserved untouched.
 */

/** Agent Skills allows lowercase alphanumerics and single hyphens, up to 64 chars. */
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;

export interface SkillFrontmatterInput {
  slug: string;
  name: string;
  summary?: string | null;
}

interface SplitMarkdown {
  frontmatter: string;
  body: string;
}

function splitFrontmatter(markdown: string): SplitMarkdown {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: '', body: markdown };
  return { frontmatter: match[1], body: markdown.slice(match[0].length) };
}

/** `Brand Guidelines!` → `brand-guidelines`. Falls back to `skill` when nothing survives. */
export function toSkillName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME)
    .replace(/-+$/, '');
  return slug || 'skill';
}

/** One-line YAML scalar. Quote only when the value could be misread. */
function yamlScalar(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return /^[A-Za-z0-9][A-Za-z0-9 ._/()-]*$/.test(flat) ? flat : JSON.stringify(flat);
}

/**
 * Keys this module owns. Any other line in the author's frontmatter is carried
 * through byte-for-byte, including list and nested forms we do not parse.
 */
const MANAGED_KEYS = new Set(['name', 'description', 'summary']);

function carriedLines(frontmatter: string): string[] {
  const out: string[] = [];
  let skippingManagedBlock = false;
  for (const line of frontmatter.split(/\r?\n/)) {
    const keyMatch = line.match(/^([A-Za-z0-9_-]+)\s*:/);
    if (keyMatch) {
      skippingManagedBlock = MANAGED_KEYS.has(keyMatch[1].toLowerCase());
      if (skippingManagedBlock) continue;
      out.push(line);
      continue;
    }
    // Continuation of the previous key (list item, folded string, comment).
    if (!skippingManagedBlock && line.trim()) out.push(line);
  }
  return out;
}

/**
 * The exact bytes we serve for download, install and the agent index: the author's
 * markdown with a frontmatter block that an Agent Skills client will accept.
 */
export function toAgentSkillMarkdown(skill: SkillFrontmatterInput, markdown: string): string {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const description = (skill.summary || '').trim().slice(0, MAX_DESCRIPTION);
  const lines = [
    `name: ${yamlScalar(toSkillName(skill.slug || skill.name))}`,
    `description: ${yamlScalar(description || skill.name)}`,
    ...carriedLines(frontmatter),
  ];
  return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\s*\n/, '')}`;
}

/** Description an agent index shows for the skill, without loading the body. */
export function skillDescription(name: string, summary?: string | null): string {
  const text = (summary || '').replace(/\s+/g, ' ').trim();
  return (text || name).slice(0, MAX_DESCRIPTION);
}
