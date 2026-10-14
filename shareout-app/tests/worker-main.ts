// Test-only worker entry. The pool imports `main` into every file that uses
// `cloudflare:test` (and lazily whenever a test touches a Durable Object), so this
// exports just the DO classes the bindings in wrangler.test.toml need, not the whole
// router (src/index.ts). ChatDO and Showtime are stubs here: the real ones pull in
// the agent loop and the screenshot/summary stack (~8s per file); no test here uses them. Tests that need a real chat session run in the `workers-chat`
// project (vitest.config.ts), whose main is src/index.ts.
import { DurableObject } from 'cloudflare:workers';

export { RealtimeCoordinator } from '../src/realtime/coordinator';
export { CommentsCoordinator } from '../src/realtime/comments-coordinator';
export { MiniDB } from '../src/data/minidb';
export { PresenceCoordinator } from '../src/realtime/presence-coordinator';
export { KnowledgeStore } from '../src/knowledge/corpus/store-do';

export class ChatDO extends DurableObject {}
export class Showtime extends DurableObject {}

export default {
  async fetch(): Promise<Response> {
    return new Response('test worker', { status: 404 });
  },
};
