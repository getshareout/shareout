import { frame } from '../frame';
import type { StarterArtifact } from '../types';

const head = `
<style>
  .sh-intro{margin:0 0 22px}
  .sh-intro h2{margin:0 0 8px}
  .sh-intro p{margin:0;color:var(--so-ink-2);font-size:14px}
  .sh-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
  @media (max-width:560px){.sh-grid{grid-template-columns:1fr}}
  .sh-tile{display:flex;flex-direction:column;gap:6px}
  .sh-tile .so-pill{margin-bottom:2px}
  .sh-tile .sh-name{font-weight:650;font-size:14px;letter-spacing:-.01em}
  .sh-tile .sh-line{color:var(--so-ink-2);font-size:13px}
  .sh-close{margin-top:24px;color:var(--so-ink-2);font-size:13.5px}
</style>`;

function tile(feature: string, name: string, line: string): string {
  return (
    '<div class="so-card sh-tile">' +
    '<span class="so-pill">' + feature + '</span>' +
    '<div class="sh-name">' + name + '</div>' +
    '<div class="sh-line">' + line + '</div>' +
    '</div>'
  );
}

const tiles = [
  tile('so.json', 'Visitor counter', 'A value that persists between visits.'),
  tile('so.table', 'Feedback wall', 'A real database behind a simple form.'),
  tile('so.table', 'Kanban board', 'Cards in columns, synced live across viewers.'),
  tile('realtime', 'Live poll', 'Votes land in real time, no refresh.'),
  tile('charts', 'KPI dashboard', 'Charts drawn straight from your data.'),
  tile('so.blobs', 'Image gallery', 'Drag-and-drop file uploads that stick around.'),
  tile('realtime', 'Collab notes', 'Two people editing the same doc at once.'),
  tile('so.comments', 'Commentable page', 'Readers leave comments inline.'),
  tile('so.agent', 'Ask AI', 'A chat assistant living inside the page.'),
].join('');

const body =
  '<section class="sh-intro">' +
  '<h2>Welcome to ShareOut</h2>' +
  '<p>You described an idea, and ShareOut turned it into a live, shareable page with real ' +
  'data behind it — no servers to run, nothing to deploy. The examples below were added to ' +
  'your home so you can see what is possible.</p>' +
  '</section>' +
  '<div class="sh-grid">' + tiles + '</div>' +
  '<p class="sh-close">Open any example to see it work, edit it to make it yours, or delete ' +
  'the ones you do not need. They all belong to you.</p>';

const script = '';

export const startHere: StarterArtifact = {
  slug: 'start-here',
  name: 'Start here',
  description: 'A quick tour of what you can build with ShareOut.',
  feature: 'welcome',
  tier: 'personal',
  html: frame({
    title: 'Start here',
    feature: 'welcome',
    description: 'Your idea is now a live page. Here is what else you can build.',
    head,
    body,
    script,
  }),
};
