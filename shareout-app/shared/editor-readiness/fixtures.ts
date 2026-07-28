/**
 * Shared editor-readiness fixtures + golden expectations.
 *
 * The DOM adapter (editor, happy-dom) and the HTMLRewriter adapter (worker, workerd)
 * run in different test environments, so a single dual-adapter test isn't possible.
 * Instead both test suites import these fixtures and assert their serialized profile
 * equals the SAME `expected` golden here — which is what guarantees the two adapters
 * cannot drift. `serializeProfile` drops non-serializable element refs and normalizes
 * the engine-specific JSON parse-error text so the goldens are environment-stable.
 */

import type { ReadinessProfile } from './model';

export function serializeProfile(profile: ReadinessProfile): unknown {
  // Strip the non-serializable element ref explicitly — in the DOM adapter it is a live
  // Element that JSON.stringify turns into `{}` rather than dropping, which would
  // otherwise diverge from the worker adapter (where ref is undefined).
  const cleaned = {
    ...profile,
    findings: profile.findings.map((finding) => {
      const { ref, ...rest } = finding;
      void ref;
      return rest;
    }),
  };
  const plain = JSON.parse(JSON.stringify(cleaned)) as ReadinessProfile;
  plain.findings = plain.findings.map((finding) =>
    finding.rule === 'manifest-errors' ? { ...finding, message: '<manifest-error>' } : finding
  );
  return plain;
}

const MANIFEST_OK = '<script type="shareout/manifest">{"version":"2.0","sources":{"json":{"count":{"default":{}}}}}</script>';

export interface ReadinessFixture {
  name: string;
  html: string;
  expected: unknown;
}

export const FIXTURES: ReadinessFixture[] = [
  {
    name: 'good',
    html: `<!doctype html><html><head>${MANIFEST_OK}</head><body>
      <div data-shareout-page="home" data-shareout-page-title="Home">
        <span data-shareout-binding="json:count">0</span>
      </div></body></html>`,
    expected: {
      manifest: 'valid',
      outline: true,
      counts: { pages: 1, sections: 0, bindings: 1, templates: 0 },
      summary: { errors: 0, warnings: 0, infos: 0 },
      findings: [],
    },
  },
  {
    name: 'missing-manifest',
    html: `<!doctype html><html><body>
      <div data-shareout-page="home">
        <span data-shareout-binding="json:count">0</span>
      </div></body></html>`,
    expected: {
      manifest: 'missing',
      outline: true,
      counts: { pages: 1, sections: 0, bindings: 1, templates: 0 },
      summary: { errors: 0, warnings: 1, infos: 0 },
      findings: [
        {
          id: 'binding-undeclared-0',
          rule: 'binding-undeclared',
          level: 'warning',
          category: 'binding',
          message: 'Binding "json:count" references undeclared json "count"',
          suggestion: 'Declare "count" in the manifest sources',
          disables: 'inline editing and formatting of this value',
        },
      ],
    },
  },
  {
    name: 'invalid-manifest',
    html: `<!doctype html><html><head>
      <script type="shareout/manifest">{ not valid json }</script>
      </head><body><div data-shareout-page="home"></div></body></html>`,
    expected: {
      manifest: 'invalid',
      outline: true,
      counts: { pages: 1, sections: 0, bindings: 0, templates: 0 },
      summary: { errors: 1, warnings: 0, infos: 0 },
      findings: [
        {
          id: 'manifest-error-0',
          rule: 'manifest-errors',
          level: 'error',
          category: 'manifest',
          message: '<manifest-error>',
          suggestion: 'Fix the manifest JSON syntax',
          disables: 'manifest-driven autocomplete, data panel, and mock preview',
        },
      ],
    },
  },
  {
    name: 'broken-modal',
    html: `<!doctype html><html><body>
      <div data-shareout-page="home">
        <div data-shareout-modal="confirm">Are you sure?</div>
      </div></body></html>`,
    expected: {
      manifest: 'missing',
      outline: true,
      counts: { pages: 1, sections: 0, bindings: 0, templates: 0 },
      summary: { errors: 0, warnings: 1, infos: 0 },
      findings: [
        {
          id: 'modal-no-trigger-confirm',
          rule: 'modal-no-open-trigger',
          level: 'warning',
          category: 'action',
          message: 'Modal "confirm" has no open trigger',
          suggestion:
            'Add a button with data-shareout-action="open" data-shareout-action-target="modal:confirm"',
          disables: 'opening this modal from the editor',
        },
      ],
    },
  },
  {
    name: 'orphan-case',
    html: `<!doctype html><html><body>
      <div data-shareout-page="home">
        <div data-shareout-case="a">x</div>
      </div></body></html>`,
    expected: {
      manifest: 'missing',
      outline: true,
      counts: { pages: 1, sections: 0, bindings: 0, templates: 0 },
      summary: { errors: 0, warnings: 1, infos: 0 },
      findings: [
        {
          id: 'orphan-case-0',
          rule: 'orphan-case',
          level: 'warning',
          category: 'orphan',
          message: 'Case element is not inside a switch container',
          suggestion: 'Wrap cases in a parent with data-shareout-switch',
          disables: 'switch/case preview',
        },
      ],
    },
  },
  {
    name: 'form-no-submit',
    html: `<!doctype html><html><body>
      <div data-shareout-page="home">
        <div data-shareout-form="signup"></div>
      </div></body></html>`,
    expected: {
      manifest: 'missing',
      outline: true,
      counts: { pages: 1, sections: 0, bindings: 0, templates: 0 },
      summary: { errors: 0, warnings: 1, infos: 0 },
      findings: [
        {
          id: 'form-no-submit-signup',
          rule: 'form-no-submit',
          level: 'warning',
          category: 'form',
          message: 'Form "signup" has no submit mechanism',
          suggestion: 'Add data-shareout-form-submit attribute or a submit button',
          disables: 'form submission preview',
        },
      ],
    },
  },
  {
    // Ancestor tracking: a <button> with no type counts as the form's submit descendant.
    name: 'form-with-submit-button',
    html: `<!doctype html><html><body>
      <div data-shareout-page="home">
        <div data-shareout-form="signup"><button>Go</button></div>
      </div></body></html>`,
    expected: {
      manifest: 'missing',
      outline: true,
      counts: { pages: 1, sections: 0, bindings: 0, templates: 0 },
      summary: { errors: 0, warnings: 0, infos: 0 },
      findings: [],
    },
  },
  {
    // Ancestor tracking: a case nested in a switch is not orphaned; a non-binding
    // switch expression produces no conditional finding.
    name: 'case-in-switch',
    html: `<!doctype html><html><body>
      <div data-shareout-page="home">
        <div data-shareout-switch="status"><div data-shareout-case="a">x</div></div>
      </div></body></html>`,
    expected: {
      manifest: 'missing',
      outline: true,
      counts: { pages: 1, sections: 0, bindings: 0, templates: 0 },
      summary: { errors: 0, warnings: 0, infos: 0 },
      findings: [],
    },
  },
  {
    // Ancestor tracking: required field resolves its id from the nearest field ancestor.
    name: 'required-field',
    html: `<!doctype html><html><body>
      <div data-shareout-page="home">
        <div data-shareout-field="email"><input data-shareout-field-required="true"></div>
      </div></body></html>`,
    expected: {
      manifest: 'missing',
      outline: true,
      counts: { pages: 1, sections: 0, bindings: 0, templates: 0 },
      summary: { errors: 0, warnings: 0, infos: 1 },
      findings: [
        {
          id: 'required-no-error-0',
          rule: 'required-field-no-validation',
          level: 'info',
          category: 'form',
          message: 'Required field "email" has no error display element',
          suggestion: 'Add <span data-shareout-error="email"></span> for validation feedback',
          disables: 'required-field validation feedback',
        },
      ],
    },
  },
  {
    // Manifest source declared without a `default` → editor previews it empty.
    name: 'source-without-default',
    html: `<!doctype html><html><head>
      <script type="shareout/manifest">{"version":"2.0","sources":{"tables":{"rooms":{"schema":[{"name":"id","type":"string","primary":true}]}}}}</script>
      </head><body><div data-shareout-page="home"></div></body></html>`,
    expected: {
      manifest: 'valid',
      outline: true,
      counts: { pages: 1, sections: 0, bindings: 0, templates: 0 },
      summary: { errors: 0, warnings: 0, infos: 1 },
      findings: [
        {
          id: 'source-without-default-0',
          rule: 'source-without-default',
          level: 'info',
          category: 'manifest',
          message: 'Source "table:rooms" has no default sample data — the visual editor previews it empty',
          suggestion: 'Add a "default" to "table:rooms" in the manifest so the editor can preview real-looking content',
          disables: 'sample data in the editor preview',
        },
      ],
    },
  },
  {
    // Live connector declared without a `default` → editor previews it empty (mock mechanism).
    name: 'connection-without-default',
    html: `<!doctype html><html><head>
      <script type="shareout/manifest">{"version":"2.0","sources":{"connections":{"warehouse":{}}}}</script>
      </head><body><div data-shareout-page="home"></div></body></html>`,
    expected: {
      manifest: 'valid',
      outline: true,
      counts: { pages: 1, sections: 0, bindings: 0, templates: 0 },
      summary: { errors: 0, warnings: 1, infos: 2 },
      findings: [
        {
          id: 'source-without-default-0',
          rule: 'source-without-default',
          level: 'info',
          category: 'manifest',
          message: 'Source "connection:warehouse" has no default sample data — the visual editor previews it empty',
          suggestion: 'Add a "default" to "connection:warehouse" in the manifest so the editor can preview real-looking content',
          disables: 'sample data in the editor preview',
        },
        {
          id: 'connection-without-provenance-0',
          rule: 'connection-without-provenance',
          level: 'warning',
          category: 'provenance',
          message: 'Live source "connection:warehouse" declares no query or description — viewers can\'t tell where this data comes from',
          suggestion: 'Add "query", "description", and/or "replication" to sources.connections.warehouse so the Data sources drawer can explain it',
          disables: 'the "where does this come from?" entry in the Data sources drawer',
        },
        {
          id: 'elements-without-source-link',
          rule: 'elements-without-source-link',
          level: 'info',
          category: 'provenance',
          message: 'No chart or table is linked to its data source',
          suggestion: 'Tag charts/tables with data-shareout-source="<sourceKey>" (or add manifest "feeds") so viewers get a per-element "where from?" badge',
          disables: 'per-element "where from?" badges for viewers',
        },
      ],
    },
  },
  {
    // Provenance declared (query + description + feed + data-shareout-source) → no provenance findings.
    name: 'connection-with-provenance',
    html: `<!doctype html><html><head>
      <script type="shareout/manifest">{"version":"2.0","sources":{"connections":{"warehouse":{"default":[],"description":"Snowflake ANALYTICS_WH","query":"SELECT * FROM companies"}}},"feeds":[{"element":"#chart","source":"connection:warehouse"}]}</script>
      </head><body><div data-shareout-page="home">
        <div id="chart" data-shareout-source="connection:warehouse"></div>
      </div></body></html>`,
    expected: {
      manifest: 'valid',
      outline: true,
      counts: { pages: 1, sections: 0, bindings: 0, templates: 0 },
      summary: { errors: 0, warnings: 0, infos: 0 },
      findings: [],
    },
  },
];
