#!/usr/bin/env node
/**
 * Give a fresh clone a working `.dev.vars` before `wrangler dev` starts.
 *
 * Without this, first run fails in a way that names nothing: `.dev.vars` is gitignored, so
 * a clone has no SESSION_SECRET, and signing a session with an empty secret throws
 *
 *   DataError: Imported HMAC key length (0) must be a non-zero value ...
 *
 * as an opaque 500 on every auth route — including `/auth/dev`, the localhost login helper
 * that is supposed to need no configuration at all. Copying `.dev.vars.example` by hand did
 * not help either, since `SESSION_SECRET=` ships empty there too.
 *
 * This runs as `predev`, so it only ever touches a developer's machine. Nothing here
 * executes in a deployed Worker: production secrets come from `wrangler secret put`, and a
 * missing secret there must keep failing rather than get a generated default.
 *
 * Idempotent — an existing non-empty SESSION_SECRET is left alone.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const devVars = join(appDir, '.dev.vars');
const example = join(appDir, '.dev.vars.example');

if (!existsSync(devVars)) {
  if (!existsSync(example)) {
    console.error('predev: no .dev.vars and no .dev.vars.example to copy from — skipping.');
    process.exit(0);
  }
  copyFileSync(example, devVars);
  console.log('predev: created .dev.vars from .dev.vars.example');
}

const text = readFileSync(devVars, 'utf8');
const line = text.match(/^SESSION_SECRET=(.*)$/m);

if (line && line[1].trim()) process.exit(0);

const secret = randomBytes(32).toString('hex');
const filled = line
  ? text.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`)
  : `${text.replace(/\n*$/, '\n')}SESSION_SECRET=${secret}\n`;

writeFileSync(devVars, filled);
console.log(
  'predev: generated a local SESSION_SECRET in .dev.vars — sign-in works now.\n' +
    '        Local only, and never used by a deployed Worker.'
);
