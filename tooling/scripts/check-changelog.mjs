#!/usr/bin/env node
// A branch that changes what people or integrators see (API routes, MCP tools, UI copy, the
// SDK, the OpenAPI spec) must also change CHANGELOG.md — the "## Release notes" line that the
// docs site's What's new / Novedades pages render. Not user-visible after all? Add a line
// `Changelog: none` to one of the branch's commit messages.
//
// Also validates the Release notes format with the same parser the docs pages use.
// Runs in the pre-push static checks (ci-check-fast.sh). Base: SHAREOUT_TEST_BASE or origin/main.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const USER_FACING = [
	/^shareout-app\/src\/mcp\//,
	/^shareout-app\/src\/router\/api\//,
	/^shareout-app\/src\/.*\/routes(\.ts|\/)/,
	/^shareout-app\/src\/pages\/home\/home-i18n\/copy\//,
	/^shareout-app\/src\/.*(^|\/|-)copy\.ts$/,
	/^shareout-app\/sdk\/src\//,
	/^docs-site\/src\/openapi\/shareout\.yaml$/,
];
const isTest = (f) => /(^|\/)tests?\//.test(f) || /\.test\.[cm]?[jt]sx?$/.test(f);

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

// 2. A user-facing change carries its changelog line.
const base = process.env.SHAREOUT_TEST_BASE || 'origin/main';
let mergeBase = '';
try { mergeBase = git('merge-base', base, 'HEAD'); } catch { /* no base ref */ }
if (!mergeBase) {
	console.log(`check:changelog — skipped the changelog-line rule: no ${base} to compare with`);
} else {
	const changed = git('diff', '--name-only', `${mergeBase}...HEAD`).split('\n').filter(Boolean);
	const facing = changed.filter((f) => !isTest(f) && USER_FACING.some((re) => re.test(f)));
	const optedOut = /^changelog:\s*none\b/im.test(git('log', '--format=%B', `${mergeBase}..HEAD`));
	if (facing.length && !changed.includes('CHANGELOG.md') && !optedOut) {
		failed = true;
		console.error(
			'check:changelog — this branch changes what people or integrators see but not CHANGELOG.md:\n' +
				facing.slice(0, 8).map((f) => `  ${f}`).join('\n') +
				(facing.length > 8 ? `\n  … and ${facing.length - 8} more` : '') +
				'\nAdd its line under "## Release notes" (today\'s date, English + "es:" + "Integrators:"),\n' +
				'and update the skill, MCP text and docs in the same PR (AGENTS.md → Every user-visible change).\n' +
				'Not user-visible? Add a line "Changelog: none" to one of this branch\'s commit messages.',
		);
	}
}

process.exit(failed ? 1 : 0);
