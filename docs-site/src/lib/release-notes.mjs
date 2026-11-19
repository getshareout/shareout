// The "## Release notes" section of the repo's CHANGELOG.md is the one source for the docs
// site's What's new / Novedades pages. Plain ESM with no dependencies so the local gate
// (tooling/scripts/check-changelog.mjs) can validate the same format the pages render.
//
//   ## Release notes
//   ### 2026-11-18
//   - **Headline.** One or two sentences for someone who uses ShareOut.
//     - es: **Titular.** Lo mismo, en español.
//     - Guide: /everyone/inbox/#anchor            (optional, docs path)
//     - Guía: /es/everyone/inbox/#ancla           (optional, docs path)
//     - Integrators: routes, tools, fields. (#316, #317)   (optional)
//
// Continuation lines are indented under the line they belong to.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SECTION = /^## Release notes\s*$/;
const DATE = /^### (\d{4}-\d{2}-\d{2})\s*$/;
const KEYS = { 'es': 'es', 'guide': 'guide', 'guía': 'guia', 'guia': 'guia', 'integrators': 'tech' };

/** CHANGELOG.md next to docs-site/, or in the nearest parent that has one. */
export function findChangelog(from = process.cwd()) {
	let dir = resolve(from);
	for (let i = 0; i < 5; i++) {
		const p = join(dir, 'CHANGELOG.md');
		if (existsSync(p)) return p;
		const up = dirname(dir);
		if (up === dir) break;
		dir = up;
	}
	throw new Error(`release-notes: no CHANGELOG.md found from ${from}`);
}

/**
 * Parse the Release notes section. Returns { days: [{ date, entries: [{ en, es, guide, guia, tech, line }] }], errors }.
 * Errors are strings with the CHANGELOG line number; callers decide whether to throw.
 */
export function parseReleaseNotes(markdown) {
	const lines = markdown.split('\n');
	const start = lines.findIndex((l) => SECTION.test(l));
	const errors = [];
	if (start === -1) return { days: [], errors: ['CHANGELOG.md has no "## Release notes" section'] };
	const days = [];
	let day = null;
	let entry = null;
	let field = null; // where a continuation line goes
	for (let i = start + 1; i < lines.length; i++) {
		const raw = lines[i];
		const n = i + 1;
		if (/^## /.test(raw)) break;
		if (/^### /.test(raw)) {
			const m = raw.match(DATE);
			if (!m) { errors.push(`line ${n}: date headings are "### YYYY-MM-DD"`); day = null; continue; }
			if (days.length && m[1] > days[days.length - 1].date) errors.push(`line ${n}: ${m[1]} is above an older date — newest first`);
			day = { date: m[1], entries: [] };
			days.push(day);
			entry = null; field = null;
			continue;
		}
		if (/^- /.test(raw)) {
			if (!day) { errors.push(`line ${n}: an entry before any "### YYYY-MM-DD" heading`); continue; }
			entry = { en: raw.slice(2).trim(), es: '', guide: '', guia: '', tech: '', line: n };
			day.entries.push(entry);
			field = 'en';
			continue;
		}
		const sub = raw.match(/^ {2,4}- ([^:]+):\s*(.*)$/);
		if (sub && entry) {
			const key = KEYS[sub[1].trim().toLowerCase()];
			if (!key) { errors.push(`line ${n}: unknown sub-line "${sub[1]}" (use es, Guide, Guía or Integrators)`); field = null; continue; }
			entry[key] = sub[2].trim();
			field = key;
			continue;
		}
		if (/^\s+\S/.test(raw) && entry && field) { entry[field] += ' ' + raw.trim(); continue; }
		if (raw.trim() === '' ) continue;
		if (!day && !entry) continue; // intro paragraph under the section heading
		errors.push(`line ${n}: unexpected line in Release notes: ${raw.slice(0, 60)}`);
	}
	for (const d of days) {
		if (!d.entries.length) errors.push(`${d.date}: no entries`);
		for (const e of d.entries) {
			if (!e.es) errors.push(`line ${e.line}: entry has no "es:" line (the Novedades page needs it)`);
			if (e.guide && !e.guide.startsWith('/')) errors.push(`line ${e.line}: Guide must be a docs path starting with /`);
			if (e.guia && !e.guia.startsWith('/es/')) errors.push(`line ${e.line}: Guía must be a docs path starting with /es/`);
		}
	}
	return { days, errors };
}

/** Read and parse; throws with every format error at once. */
export function loadReleaseNotes(from) {
	const path = findChangelog(from);
	const { days, errors } = parseReleaseNotes(readFileSync(path, 'utf8'));
	if (errors.length) throw new Error(`release-notes: ${path}\n  ${errors.join('\n  ')}`);
	return days;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The inline Markdown the notes use: `code`, **bold**, [text](url), and (#123) PR refs. */
export function inlineHtml(text, repo = 'https://github.com/getshareout/shareout') {
	const parts = text.split(/(`[^`]+`)/);
	return parts
		.map((p) => {
			if (p.startsWith('`') && p.endsWith('`') && p.length > 1) return `<code>${esc(p.slice(1, -1))}</code>`;
			return esc(p)
				.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
				.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`)
				.replace(/#(\d{2,5})\b/g, (_, num) => `<a href="${repo}/pull/${num}">#${num}</a>`);
		})
		.join('');
}

/** The bold lead of an entry ("**Keep a table up to date by email.** …") without the stars or the final period. */
export function headline(text) {
	const m = text.match(/^\*\*([^*]+)\*\*/);
	return (m ? m[1] : text.split(/(?<=\.)\s/)[0]).trim().replace(/[.:]$/, '');
}

/**
 * A stable anchor per entry: the date plus the English headline, so a shared link points at the
 * same change on What's new and on Novedades. Repeats on one date get -2, -3.
 */
export function withAnchors(days) {
	return days.map((day) => {
		const seen = new Map();
		return {
			...day,
			entries: day.entries.map((e) => {
				const slug = headline(e.en)
					.normalize('NFD')
					.replace(/[̀-ͯ]/g, '')
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-+|-+$/g, '')
					.split('-')
					.reduce((acc, w) => (acc && acc.length + w.length >= 60 ? acc : acc ? `${acc}-${w}` : w), '');
				const base = `${day.date}-${slug || 'change'}`;
				const n = (seen.get(base) || 0) + 1;
				seen.set(base, n);
				return { ...e, anchor: n > 1 ? `${base}-${n}` : base };
			}),
		};
	});
}

/** Atom feed of the Release notes in one language. `site` has no trailing slash. */
export function atomFeed(days, { lang, site, repo }) {
	const es = lang === 'es';
	const page = `${site}${es ? '/es' : ''}/whats-new/`;
	const title = es ? 'ShareOut — Novedades' : 'ShareOut — What’s new';
	const guideLabel = es ? 'Ver la guía' : 'Read the guide';
	const entries = withAnchors(days).flatMap((d) =>
		d.entries.map((e) => {
			const text = es ? e.es : e.en;
			const guide = es ? e.guia : e.guide;
			const html = `<p>${inlineHtml(text, repo)}</p>` + (guide ? `<p><a href="${esc(site + guide)}">${guideLabel} →</a></p>` : '');
			return [
				'  <entry>',
				`    <id>${esc(page + '#' + e.anchor)}</id>`,
				`    <title>${esc(headline(text))}</title>`,
				`    <link rel="alternate" href="${esc(page + '#' + e.anchor)}"/>`,
				`    <updated>${d.date}T12:00:00Z</updated>`,
				`    <content type="html">${esc(html)}</content>`,
				'  </entry>',
			].join('\n');
		}),
	);
	return [
		'<?xml version="1.0" encoding="utf-8"?>',
		`<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${es ? 'es' : 'en'}">`,
		`  <id>${esc(page)}</id>`,
		`  <title>${esc(title)}</title>`,
		`  <link rel="alternate" href="${esc(page)}"/>`,
		`  <link rel="self" href="${esc(`${site}${es ? '/es' : ''}/whats-new.xml`)}"/>`,
		`  <updated>${days.length ? days[0].date : '1970-01-01'}T12:00:00Z</updated>`,
		'  <author><name>ShareOut</name></author>',
		...entries,
		'</feed>',
		'',
	].join('\n');
}
