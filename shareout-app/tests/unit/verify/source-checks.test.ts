import { describe, expect, it } from 'vitest';
import { sourceIssues, type SourceFile } from '../../../src/verify/source-checks';
import type { Env } from '../../../src/types';

const env = { SHAREOUT_BASE_URL: 'https://shareout.example', ARTIFACT_ORIGIN: 'https://shareout.example' } as unknown as Env;
const html = (text: string, path = 'index.html'): SourceFile => ({ path, mime: 'text/html', text });
const rules = (files: SourceFile[], isPublic = false) => sourceIssues(files, { env, isPublic });
const byRule = (files: SourceFile[], rule: string, isPublic = false) => rules(files, isPublic).find((i) => i.rule === rule);

describe('absolute_path', () => {
  it('flags a root-relative stylesheet with the fix and where it is', () => {
    const issue = byRule([html('<!doctype html>\n<html>\n<head>\n<link rel="stylesheet" href="/styles.css">\n</head></html>')], 'absolute_path');
    expect(issue).toMatchObject({ check: 'source', severity: 'error', where: 'index.html:4:30', count: 1 });
    expect(issue!.message).toContain('href="/styles.css"');
    expect(issue!.hint).toContain('"styles.css"');
    expect(issue!.hint).toContain('not "/styles.css"');
  });

  it('flags CSS url() and JS fetch/import of the page\'s own files, across files', () => {
    const issue = byRule([
      html('<script>fetch("/data.json"); import("/mod.js");</script>'),
      { path: 'css/site.css', mime: 'text/css', text: 'body{}\n.hero{background:url(/img/hero.png)}' },
    ], 'absolute_path');
    expect(issue!.count).toBe(3);
    expect(issue!.where).toContain('css/site.css:2:');
  });

  it('leaves shared bundles, protocol-relative, absolute and relative URLs alone', () => {
    expect(byRule([html([
      '<script src="/sdk/shareout.js"></script>',
      '<script src="/vendor/d3@7/dist/d3.min.js"></script>',
      '<script type="module" src="/lib/acme/ui@1.0.0.js"></script>',
      '<img src="//cdn.example.com/x.png"><img src="https://example.com/x.png"><link href="styles.css" rel="stylesheet">',
    ].join('\n'))], 'absolute_path')).toBeUndefined();
  });
});

describe('code patterns', () => {
  it('flags localStorage in a script but not in prose', () => {
    const issue = byRule([html('<p>We never use localStorage.</p>\n<script>\n  const v = localStorage.getItem("x");\n</script>')], 'browser_storage');
    expect(issue).toMatchObject({ severity: 'warning', where: 'index.html:3:13', count: 1 });
    expect(issue!.hint).toContain('SecurityError');
  });

  it('flags alert() but not a method named alert, and skips comment lines', () => {
    const files = [{ path: 'app.js', mime: 'application/javascript', text: 'toast.alert("x");\n// alert("old")\nwindow.alert("hi");\nmyalert(1);' }];
    expect(byRule(files, 'native_dialog')).toMatchObject({ where: 'app.js:3:1', count: 1 });
  });

  it('flags raw /v1/data fetches and the SDK constructor as errors', () => {
    const list = rules([html('<script>fetch(`/v1/data/${id}/json/x`);\nconst so = new ShareOut();</script>')]);
    expect(list.find((i) => i.rule === 'raw_data_fetch')).toMatchObject({ severity: 'error' });
    expect(list.find((i) => i.rule === 'sdk_constructor')).toMatchObject({ severity: 'error' });
    expect(list.find((i) => i.rule === 'sdk_constructor')!.hint).toContain('ShareOut.create()');
  });

  it('ignores JSON data blocks', () => {
    expect(rules([html('<script type="application/json">{"note":"alert(1) localStorage"}</script>')])).toEqual([]);
  });
});

describe('cdn_not_allowed', () => {
  const page = html('<script src="https://cdn.jsdelivr.net/npm/x@1/x.js"></script>\n<script src="https://evil-cdn.example.net/lib.js"></script>');

  it('flags a script host outside the allowlist on a public page', () => {
    const issue = byRule([page], 'cdn_not_allowed', true);
    expect(issue).toMatchObject({ severity: 'error', where: 'index.html:2:1', count: 1 });
    expect(issue!.message).toContain('evil-cdn.example.net');
    expect(issue!.message).not.toContain('jsdelivr');
  });

  it('does not apply to private pages (their CSP allows any https host)', () => {
    expect(byRule([page], 'cdn_not_allowed', false)).toBeUndefined();
  });
});
