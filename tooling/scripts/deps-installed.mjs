#!/usr/bin/env node
// Exit 0 when a node_modules tree holds exactly what a lockfile asks for.
//
//   node tooling/scripts/deps-installed.mjs <app-dir> [<node_modules-owner-dir>]
//
// npm records what it actually installed in node_modules/.package-lock.json. Compare
// that, package by package (version, resolved, integrity, link), with
// <app-dir>/package-lock.json. The second argument checks another checkout's
// node_modules against <app-dir>'s lockfile (new-worktree.sh asks "may I clone the
// primary's tree?"). Directory existence and mtimes are not evidence: a tree can be a
// leftover `.cache/`, or installed from an older lockfile that a checkout or rebase
// gave a newer mtime.
//
// Prints the reason on mismatch, nothing on a match.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const [appDir, ownerDir = appDir] = process.argv.slice(2);
if (!appDir) {
  console.error('usage: deps-installed.mjs <app-dir> [<node_modules-owner-dir>]');
  process.exit(2);
}

const lockPath = path.join(appDir, 'package-lock.json');
const installedPath = path.join(ownerDir, 'node_modules', '.package-lock.json');

function fail(reason) {
  console.log(reason);
  process.exit(1);
}

if (!existsSync(lockPath)) fail(`no ${lockPath}`);
if (!existsSync(installedPath)) fail(`no ${installedPath} (nothing installed by npm)`);

const read = (p) => JSON.parse(readFileSync(p, 'utf8')).packages || {};
const wanted = read(lockPath);
const installed = read(installedPath);

// The root entry ("") is the app itself and is not in the installed record. npm adds
// `ideallyInert` to optional packages it skipped for this platform; that is not a
// different install.
const key = (p) => JSON.stringify([p.version, p.resolved, p.integrity, Boolean(p.link)]);
const names = new Set([...Object.keys(wanted), ...Object.keys(installed)]);
names.delete('');

const diffs = [];
for (const name of names) {
  const w = wanted[name];
  const i = installed[name];
  if (!w) diffs.push(`${name}: installed, not in lockfile`);
  else if (!i) diffs.push(`${name}: in lockfile, not installed`);
  else if (key(w) !== key(i)) diffs.push(`${name}: installed ${i.version} (${i.resolved ?? 'link'}), lockfile wants ${w.version} (${w.resolved ?? 'link'})`);
}

if (diffs.length) {
  fail(`${diffs.length} package(s) differ from the lockfile, e.g. ${diffs.slice(0, 3).join('; ')}`);
}
