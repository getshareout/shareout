#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (!existsSync(dist)) {
	console.error('check-links: dist/ not found, run `npm run build` first');
	process.exit(2);
}

const walk = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : [],
	);

const decode = (s) =>
	s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const pages = new Map();
for (const file of walk(dist)) {
	const html = readFileSync(file, 'utf8');
	const ids = new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => decode(m[1])));
	const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
	const hrefs = [...body.matchAll(/<a\b[^>]*?\shref="([^"]*)"/gi)].map((m) => decode(m[1]));
	pages.set('/' + relative(dist, file).split('\\').join('/'), { ids, hrefs });
}

const resolveTarget = (path) => {
	const candidates = path.endsWith('/') ? [path + 'index.html'] : [path, path + '.html', path + '/index.html'];
	for (const c of candidates) {
		if (pages.has(c)) return c;
		const abs = join(dist, c);
		if (existsSync(abs) && statSync(abs).isFile()) return c;
	}
	return null;
};

const broken = [];
for (const [from, { hrefs }] of pages) {
	if (from === '/404.html') continue;
	const base = from.endsWith('/index.html') ? from.slice(0, -'index.html'.length) : posix.dirname(from) + '/';
	for (const href of new Set(hrefs)) {
		if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) continue;
		const [rawPath, rawHash = ''] = href.split('#');
		const pathOnly = rawPath.split('?')[0];
		let target = from;
		if (pathOnly) {
			const abs = pathOnly.startsWith('/') ? pathOnly : posix.join(base, pathOnly);
			let decoded;
			try { decoded = decodeURI(posix.normalize(abs)); } catch { decoded = abs; }
			target = resolveTarget(decoded);
			if (!target) { broken.push({ from, href, reason: 'missing page' }); continue; }
		}
		if (!rawHash) continue;
		let hash;
		try { hash = decodeURIComponent(rawHash); } catch { hash = rawHash; }
		const page = pages.get(target);
		if (page && !page.ids.has(hash)) broken.push({ from, href, reason: 'missing anchor' });
	}
}

const pageCount = pages.size;
if (broken.length) {
	for (const b of broken) console.log(`${b.from}\n  -> ${b.href} (${b.reason})`);
	console.log(`\ncheck-links: ${broken.length} broken link(s) across ${pageCount} pages`);
	process.exit(1);
}
console.log(`check-links: 0 broken links across ${pageCount} pages`);
