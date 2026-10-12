// @vitest-environment node
// L6: member-facing copy says what things are, not what they're called in the code.
// Admin copy and the connector credential forms (conn.*, which ask for a provider's API
// key by name) are out of scope.
import { describe, expect, it } from 'vitest';
import { SHELL_COPY } from '../../src/pages/home/home-i18n/copy/shell';
import { INSPECTOR_COPY } from '../../src/pages/home/home-i18n/copy/inspector';
import { STUDIO_COPY } from '../../src/pages/home/home-i18n/copy/studio';
import { WORKSPACE_COPY } from '../../src/pages/home/home-i18n/copy/workspace';
import { CONNECT_COPY } from '../../src/pages/home/home-i18n/copy/connect';
import { ASSETS_COPY } from '../../src/pages/home/home-i18n/copy/assets';

const JARGON = /\bcrews?\b|so\.workspace|\bAPI\b/i;

describe('member-facing copy has no developer jargon', () => {
  for (const [name, bag] of Object.entries({ SHELL_COPY, INSPECTOR_COPY, STUDIO_COPY, WORKSPACE_COPY, CONNECT_COPY, ASSETS_COPY })) {
    for (const locale of ['en', 'es'] as const) {
      it(`${name}.${locale}`, () => {
        const hits = Object.entries(bag[locale] as Record<string, string>)
          .filter(([k, v]) => !k.startsWith('conn.') && JARGON.test(v))
          .map(([k, v]) => `${k}: ${v}`);
        expect(hits).toEqual([]);
      });
    }
  }
});
