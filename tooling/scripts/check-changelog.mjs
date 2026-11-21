#!/usr/bin/env node
// A branch that changes what people or integrators see (API routes, MCP tools, assistant tools,
// UI copy, the SDK, the OpenAPI spec) ships with its words in the same branch
// (AGENTS.md → Every user-visible change):
//   - CHANGELOG.md: a line under "## Release notes" (what the docs site's What's new / Novedades
//     pages render) AND the technical entry under "## [Unreleased]";
//   - the docs-site pages (docs-site/src/content/docs/);
//   - the agent skill (skills/ShareOutSkill/) when an agent surface changed (API, MCP, assistant
//     tools, SDK, OpenAPI).
// Any branch that edits a docs page edits its other language too (en ↔ es/).
//
// Not needed this time? One line in one of the branch's commit messages:
//   `Changelog: none` — not user-visible at all (skips every rule but en/es);
//   `Docs: none` — nothing on the docs site changes; `Skill: none` — nothing an agent does changes.
//
// Also validates the Release notes format with the same parser the docs pages use.
// Runs in the pre-push static checks (ci-check-fast.sh). Base: SHAREOUT_TEST_BASE or origin/main.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const USER_FACING = [
	/^shareout-app\/src\/mcp\//,
	/^shareout-app\/src\/router\/api\//,
	/^shareout-app\/src\/.*\/routes(\.ts|\/)/,
	/^shareout-app\/src\/chat-agent\/tools\//,
	/^shareout-app\/src\/pages\/home\/home-i18n\/copy\//,
	/^shareout-app\/src\/.*(^|\/|-)copy\.ts$/,
	/^shareout-app\/sdk\/src\//,
	/^docs-site\/src\/openapi\/shareout\.yaml$/,
];
// What an agent using ShareOut calls: these also need the skill.
const AGENT_FACING = [
	/^shareout-app\/src\/mcp\//,
	/^shareout-app\/src\/router\/api\//,
	/^shareout-app\/src\/.*\/routes(\.ts|\/)/,
	/^shareout-app\/src\/chat-agent\/tools\//,
	/^shareout-app\/sdk\/src\//,
	/^docs-site\/src\/openapi\/shareout\.yaml$/,
];
const DOCS = 'docs-site/src/content/docs/';
const DOCS_PAGE = /^docs-site\/src\/content\/docs\/.+\.mdx?$/;
const SKILL = 'skills/ShareOutSkill/';
const isTest = (f) => /(^|\/)tests?\//.test(f) || /\.test\.[cm]?[jt]sx?$/.test(f);
const optOut = (messages, key) => new RegExp(`^${key}:\\s*none\\b`, 'im').test(messages);

/** 1-based [start, end) line range of a "## " section in the markdown, or null. */
function sectionRange(lines, heading) {
	const start = lines.findIndex((l) => heading.test(l));
	if (start === -1) return null;
	let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
	if (end === -1) end = lines.length;
	return [start + 1, end + 1];
}

/** Line numbers (1-based, in the new file) a unified diff with -U0 adds. */
export function addedLineNumbers(diff) {
	const out = [];
	for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
		const start = Number(m[1]);
		const count = m[2] === undefined ? 1 : Number(m[2]);
		for (let i = 0; i < count; i++) out.push(start + i);
	}
	return out;
}

/**
 * The branch rules, pure. `changed` = paths the branch touches, `messages` = its commit messages,
 * `changelog` = CHANGELOG.md at the branch head, `added` = the line numbers the branch adds to it.
 * Returns a list of problems (empty = fine).
 */
export function branchProblems({ changed, messages = '', changelog = '', added = [] }) {
	const problems = [];
	const code = changed.filter((f) => !isTest(f));
	const facing = code.filter((f) => USER_FACING.some((re) => re.test(f)));
	const agentFacing = code.filter((f) => AGENT_FACING.some((re) => re.test(f)));
	const list = (files) =>
		files.slice(0, 8).map((f) => `    ${f}`).join('\n') + (files.length > 8 ? `\n    … and ${files.length - 8} more` : '');

	if (facing.length && !optOut(messages, 'changelog')) {
		const intro = `this branch changes what people or integrators see:\n${list(facing)}\n  but`;
		if (!changed.includes('CHANGELOG.md')) {
			problems.push(
				`${intro} not CHANGELOG.md. Add its line under "## Release notes" (today's date, English + "es:" + "Integrators:") and its technical entry under "## [Unreleased]".`,
			);
		} else {
			const lines = changelog.split('\n');
			const inSection = (heading) => {
				const r = sectionRange(lines, heading);
				return !!r && added.some((n) => n > r[0] && n < r[1] && lines[n - 1].trim() !== '');
			};
			if (!inSection(/^## Release notes\s*$/))
				problems.push(`${intro} adds nothing under CHANGELOG.md "## Release notes" (the What's new / Novedades line, en + es).`);
			if (!inSection(/^## \[Unreleased\]\s*$/))
				problems.push(`${intro} adds nothing under CHANGELOG.md "## [Unreleased]" (the technical entry: routes, tools, tables, files).`);
		}
		if (!changed.some((f) => f.startsWith(DOCS)) && !optOut(messages, 'docs'))
			problems.push(
				`${intro} no docs-site page (${DOCS}, en + es). Update the guide it belongs to, or put "Docs: none" in a commit message if nothing there changes.`,
			);
		if (agentFacing.length && !changed.some((f) => f.startsWith(SKILL)) && !optOut(messages, 'skill'))
			problems.push(
				`this branch changes what an agent can call (API, MCP, assistant tools, SDK or OpenAPI) but not the skill (${SKILL}). Update it (and \`npm run build:skill\`), or put "Skill: none" in a commit message if no agent does anything differently.`,
			);
	}

	// en ↔ es: a docs page changed in one language is changed in the other.
	const pages = new Set(changed.filter((f) => DOCS_PAGE.test(f)));
	const missing = [];
	for (const f of pages) {
		const rel = f.slice(DOCS.length);
		const other = rel.startsWith('es/') ? DOCS + rel.slice(3) : DOCS + 'es/' + rel;
		if (!pages.has(other)) missing.push(`${f} → ${other}`);
	}
	if (missing.length)
		problems.push(`docs pages changed in one language only (en ↔ es); change the other one too:\n${list(missing)}`);

	return problems;
}

async function main() {
	const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
	const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
	let failed = false;

	// 1. Format: the docs pages fail to build on the same errors.
	const parserPath = join(root, 'docs-site', 'src', 'lib', 'release-notes.mjs');
	if (existsSync(parserPath)) {
		const { parseReleaseNotes } = await import(pathToFileURL(parserPath).href);
		const { errors } = parseReleaseNotes(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'));
		if (errors.length) {
			failed = true;
			console.error('check:changelog — CHANGELOG.md "## Release notes" format:\n  ' + errors.join('\n  '));
		}
	}

	// 1b. Home's "What's new in ShareOut" card is generated from the same notes.
	const whatsNew = join(root, 'shareout-app', 'scripts', 'gen-whats-new.mjs');
	if (existsSync(whatsNew)) {
		try { execFileSync(process.execPath, [whatsNew, '--check'], { cwd: join(root, 'shareout-app'), stdio: 'inherit' }); }
		catch { failed = true; }
	}

	// 2. The branch ships its words.
	const base = process.env.SHAREOUT_TEST_BASE || 'origin/main';
	let mergeBase = '';
	try { mergeBase = git('merge-base', base, 'HEAD'); } catch { /* no base ref */ }
	if (!mergeBase) {
		console.log(`check:changelog — skipped the branch rules: no ${base} to compare with`);
	} else {
		const changed = git('diff', '--name-only', `${mergeBase}...HEAD`).split('\n').filter(Boolean);
		const messages = git('log', '--format=%B', `${mergeBase}..HEAD`);
		let changelog = '';
		let added = [];
		if (changed.includes('CHANGELOG.md')) {
			changelog = git('show', 'HEAD:CHANGELOG.md');
			added = addedLineNumbers(git('diff', '-U0', `${mergeBase}...HEAD`, '--', 'CHANGELOG.md'));
		}
		const problems = branchProblems({ changed, messages, changelog, added });
		if (problems.length) {
			failed = true;
			console.error(
				'check:changelog — every user-visible change ships with its words in the same branch (AGENTS.md → Every user-visible change):\n' +
					problems.map((p) => `  - ${p}`).join('\n') +
					'\nNot user-visible at all? Add a line "Changelog: none" to one of this branch\'s commit messages.',
			);
		}
	}

	process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
