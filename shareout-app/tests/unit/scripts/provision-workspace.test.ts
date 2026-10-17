// @vitest-environment node
// The operator CLI resolves the spec file before anything is sent: env-var secrets and
// a local logo file. The example spec must stay a valid input.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { interpolateEnv, loadSpec } from '../../../scripts/provision-workspace.mjs';
import { parseProvisionSpec } from '../../../src/superadmin/provision/spec';

const EXAMPLE = fileURLToPath(new URL('../../../scripts/provision-workspace.example.yaml', import.meta.url));

describe('provision-workspace CLI', () => {
  it('loads the example spec into something the endpoint accepts', () => {
    const spec = loadSpec(EXAMPLE, { ACME_API_KEY: 'k_example' });
    expect(spec.connectors[0].credentials.data.api_key).toBe('k_example');
    const parsed = parseProvisionSpec(spec);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.spec).toMatchObject({ slug: 'acme', locale: 'es', owner_email: 'ana@acme.example.com', folders: ['Clientes', 'Proveedores', 'Reportes'] });
  });

  it('refuses a spec that names an unset variable, without echoing other values', () => {
    expect(() => interpolateEnv({ a: { b: '${MISSING_SECRET}' } }, {})).toThrow('spec.a.b references ${MISSING_SECRET}');
  });

  it('inlines a logo file next to the spec as base64', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prov-'));
    writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(dir, 'spec.json'), JSON.stringify({ name: 'Acme', slug: 'acme', admins: ['a@acme.example.com'], branding: { logo_file: 'logo.png' } }));
    const spec = loadSpec(join(dir, 'spec.json'), {});
    expect(spec.branding).toEqual({ logo: { data_base64: 'iVBORw==', content_type: 'image/png' } });
  });
});
