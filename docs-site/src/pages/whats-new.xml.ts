// Atom feed of What's new (CHANGELOG.md → "## Release notes"), for feed readers and anyone who
// wants to follow changes without visiting. Spanish: /es/whats-new.xml.
import type { APIRoute } from 'astro';
import { atomFeed, loadReleaseNotes } from '../lib/release-notes.mjs';

export const GET: APIRoute = ({ site }) =>
	new Response(
		atomFeed(loadReleaseNotes(), {
			lang: 'en',
			site: String(site ?? 'https://docs.shareout.site').replace(/\/$/, ''),
			repo: 'https://github.com/getshareout/shareout',
		}),
		{ headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' } },
	);
