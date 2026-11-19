// Atom feed of Novedades (CHANGELOG.md → "## Release notes", the es lines). English: /whats-new.xml.
import type { APIRoute } from 'astro';
import { atomFeed, loadReleaseNotes } from '../../lib/release-notes.mjs';

export const GET: APIRoute = ({ site }) =>
	new Response(
		atomFeed(loadReleaseNotes(), {
			lang: 'es',
			site: String(site ?? 'https://docs.shareout.site').replace(/\/$/, ''),
			repo: 'https://github.com/getshareout/shareout',
		}),
		{ headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' } },
	);
