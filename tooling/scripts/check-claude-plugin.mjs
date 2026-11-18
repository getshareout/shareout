#!/usr/bin/env node
/**
 * Guard: the Claude plugin (skills/.claude-plugin/plugin.json + skills/.mcp.json, listed by
 * .claude-plugin/marketplace.json) stays in step with what it ships.
 *
 * - plugin.json `version` equals the skill version (skills/ShareOutSkill/skill.json). Claude only
 *   updates an installed plugin when that version changes, so a skill bump that forgets
 *   the plugin leaves plugin users on the old skill.
 * - the marketplace lists the plugin under the same name, at ./skills.
 * - every Markdown file in the plugin has only `name` and `description` in its frontmatter:
 *   the plugin directory refuses other keys from organizations it has not verified.
 * - the bundled connector is one https `/mcp` URL.
 * - every tool the MCP server defines (shareout-app/src/mcp/) is named in
 *   skills/ShareOutSkill/integrations/mcp-connector.md.
 *
 * Usage: node tooling/scripts/check-claude-plugin.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(fileURLToPath(import.meta.url), '..', '..', '..');
const read = (...p) => readFileSync(join(repo, ...p), 'utf8');
const errors = [];

let plugin, mcp, marketplace;
try {
  plugin = JSON.parse(read('skills', '.claude-plugin', 'plugin.json'));
  mcp = JSON.parse(read('skills', '.mcp.json'));
  marketplace = JSON.parse(read('.claude-plugin', 'marketplace.json'));
} catch (e) {
  console.error(`check-claude-plugin: cannot read the plugin files: ${e.message}`);
  process.exit(1);
}

let skillVersion;
try {
  skillVersion = JSON.parse(read('skills', 'ShareOutSkill', 'skill.json')).version;
} catch (e) {
  errors.push(`cannot read skills/ShareOutSkill/skill.json: ${e.message}`);
}
if (!skillVersion) errors.push('skills/ShareOutSkill/skill.json has no version');
else if (plugin.version !== skillVersion) {
  errors.push(`skills/.claude-plugin/plugin.json version is ${plugin.version}, skill.json is ${skillVersion}: set both to the same value`);
}

const entry = (marketplace.plugins ?? []).find((p) => p.name === plugin.name);
if (!entry) errors.push(`.claude-plugin/marketplace.json does not list a plugin named "${plugin.name}"`);
else if (entry.source !== './skills') errors.push(`marketplace entry "${plugin.name}" must have source "./skills", found ${JSON.stringify(entry.source)}`);

const servers = Object.values(mcp.mcpServers ?? {});
if (servers.length !== 1) errors.push(`skills/.mcp.json must declare exactly one server, found ${servers.length}`);
for (const s of servers) {
  if (s.type !== 'http' || !/^https:\/\/[^/]+\/mcp$/.test(s.url ?? '')) {
    errors.push(`skills/.mcp.json server must be { "type": "http", "url": "https://<host>/mcp" }, found ${JSON.stringify(s)}`);
  }
}

// Tool names: every quoted snake_case word on a `name:` line (one line can hold two,
// e.g. `name: resend ? 'resend_invite' : 'revoke_invite'`).
const mcpDir = join(repo, 'shareout-app', 'src', 'mcp');
const tools = new Set();
for (const file of readdirSync(mcpDir).filter((f) => f.endsWith('.ts'))) {
  for (const line of readFileSync(join(mcpDir, file), 'utf8').split('\n')) {
    if (!/^\s*name:/.test(line) || line.includes('{')) continue; // `name: { type: 'string' }` is an input property
    for (const m of line.matchAll(/'([a-z][a-z0-9_]*)'/g)) tools.add(m[1]);
  }
}
if (tools.size === 0) errors.push('found no MCP tools in shareout-app/src/mcp/ (did the tool definitions move?)');
const doc = read('skills', 'ShareOutSkill', 'integrations', 'mcp-connector.md');
for (const tool of [...tools].sort()) {
  if (!doc.includes(`\`${tool}\``)) errors.push(`MCP tool \`${tool}\` is not documented in skills/ShareOutSkill/integrations/mcp-connector.md`);
}

const walkMd = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walkMd(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : []);
for (const file of walkMd(join(repo, 'skills'))) {
  const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, 'utf8'))?.[1];
  if (front === undefined) continue;
  for (const line of front.split('\n')) {
    const key = /^([^\s:#][^:]*):/.exec(line)?.[1];
    if (!key || !['name', 'description'].includes(key)) {
      errors.push(`${file.slice(repo.length + 1)}: frontmatter line "${line.slice(0, 40)}" — only name and description are allowed (put the rest in skills/ShareOutSkill/skill.json)`);
    }
  }
}

if (errors.length) {
  console.error('check-claude-plugin failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`check-claude-plugin: ok (plugin ${plugin.name}@${plugin.version}, ${tools.size} MCP tools documented)`);
