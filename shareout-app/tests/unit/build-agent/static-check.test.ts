import { describe, expect, it } from 'vitest';
import { PageFiles } from '../../../src/build-agent/page-files';
import { checkPage, errorsOf, formatIssues } from '../../../src/build-agent/static-check';
import { env } from './helpers';

const page = (files: Record<string, string>) => PageFiles.from(Object.entries(files).map(([path, content]) => ({ path, content })));
const check = (files: Record<string, string>) => checkPage(page(files), { env, isPublic: false });
const rules = (files: Record<string, string>) => check(files).map((i) => i.rule);

const shell = (head: string, body: string) => `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

describe('checkPage', () => {
  it('passes a clean multi-file page', () => {
    const issues = check({
      'index.html': shell('<link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="/sdk/shareout.css">', '<script src="/sdk/shareout.js"></script><script src="./app.js"></script>'),
      'styles.css': 'body{background:url(img/a.svg)}',
      'img/a.svg': '<svg/>',
      'app.js': 'const x = async () => { await 1; };',
    });
    expect(errorsOf(issues)).toEqual([]);
  });

  it('needs an index.html', () => {
    expect(rules({ 'app.js': '1' })).toEqual(['no_entrypoint']);
  });

  it('finds a JS syntax error in an inline script, with the real line', () => {
    const html = shell('', '<p>x</p>\n<script>\nconst a = 1;\nconst b = ;\n</script>');
    const [issue] = check({ 'index.html': html }).filter((i) => i.rule === 'js_syntax');
    expect(issue.severity).toBe('error');
    expect(issue.where).toMatch(/^index\.html:4/);
  });

  it('finds a JS syntax error in a .js file', () => {
    const issues = check({ 'index.html': shell('', '<script src="app.js"></script>'), 'app.js': 'function (' });
    expect(issues.find((i) => i.rule === 'js_syntax')?.where).toMatch(/^app\.js:1/);
  });

  it('tells a classic script that needs type=module', () => {
    expect(rules({ 'index.html': shell('', '<script>import x from "./a.js";</script>'), 'a.js': 'export default 1' })).toContain('js_not_module');
    // A module script and the files it imports are modules.
    const ok = check({ 'index.html': shell('', '<script type="module">import x from "./a.js";</script><script type="module" src="main.js"></script>'), 'a.js': 'export default 1', 'main.js': 'import { b } from "./b.js"; await b;', 'b.js': 'export const b = 1' });
    expect(errorsOf(ok)).toEqual([]);
    // A .js file with export that nothing loads as a module is a bug.
    expect(rules({ 'index.html': shell('', '<script src="a.js"></script>'), 'a.js': 'export default 1' })).toContain('js_not_module');
  });

  it('ignores JSON, template and manifest script blocks', () => {
    const html = shell('<script type="shareout/manifest">{"version":"2.0"}</script>', '<script type="application/json">{not js}</script><script type="text/template"><b>{{x</script>');
    expect(errorsOf(check({ 'index.html': html }))).toEqual([]);
  });

  it('flags a manifest that is not JSON', () => {
    const html = shell('<script type="shareout/manifest">{ "version": "2.0", }</script>', '');
    expect(rules({ 'index.html': html })).toContain('manifest_json');
  });

  it('flags sdk.table names the manifest does not declare', () => {
    const manifest = '<script type="shareout/manifest">{"version":"2.0","sources":{"tables":{"tasks":{"schema":[{"name":"id","type":"string","primary":true}]}}}}</script>';
    const js = 'const t = sdk.table("tasks"); const n = sdk.table(\'notes\');';
    const issues = check({ 'index.html': shell(manifest, '<script src="app.js"></script>'), 'app.js': js });
    const undeclared = issues.find((i) => i.rule === 'undeclared_table');
    expect(undeclared?.message).toContain('"notes"');
    expect(undeclared?.message).not.toContain('"tasks"');
    expect(rules({ 'index.html': shell('', '<script src="app.js"></script>'), 'app.js': js })).toContain('undeclared_table');
  });

  it('flags relative references to files that do not exist, resolved from the referring file', () => {
    const issues = check({
      'index.html': shell('<link rel="stylesheet" href="css/main.css">', '<script src="app.js"></script><img src="logo.png">'),
      'css/main.css': '@import "theme.css"; body{background:url(../bg.png)}',
    });
    const missing = issues.filter((i) => i.rule === 'missing_file').map((i) => i.message);
    expect(missing.some((m) => m.includes('"app.js"'))).toBe(true);
    expect(missing.some((m) => m.includes('"logo.png"'))).toBe(true);
    expect(missing.some((m) => m.includes('css/main.css') && m.includes('"theme.css"'))).toBe(true);
    expect(missing.some((m) => m.includes('"../bg.png"'))).toBe(true);
  });

  it('reuses the verify source rules (root-relative own files, localStorage)', () => {
    const r = rules({
      'index.html': shell('<link rel="stylesheet" href="/styles.css">', '<script>localStorage.x = 1</script>'),
      'styles.css': 'b{}',
    });
    expect(r).toContain('absolute_path');
    expect(r).toContain('browser_storage');
  });

  it('formats errors first with where and fix, capped', () => {
    const issues = check({ 'index.html': shell('', '<script>const = 1</script>') });
    const text = formatIssues(issues);
    expect(text).toMatch(/^1\. \[error\] JavaScript syntax error/);
    expect(text).toContain('fix:');
  });
});
