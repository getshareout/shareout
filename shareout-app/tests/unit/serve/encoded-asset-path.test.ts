import { describe, expect, it } from 'vitest';
import './helpers/mocks';
import { SLUG, assetsEntry, createServeEnv, defaultDeployment, serveRequest } from './helpers/env';
import { setupServeTestHooks } from './helpers/hooks';
import { handleServe } from '../../../src/serve';

setupServeTestHooks();

// Imported documents keep their original as original/<filename>, spaces included; the
// viewer's Download link percent-encodes it (Plan%20Q3.docx). Serving must decode the path.
const withOriginal = () => {
  const assets = {
    'index.html': assetsEntry('index.html'),
    'original/Plan Q3.docx': { ...assetsEntry('original/Plan Q3.docx'), mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  };
  const r2 = {
    'artifacts/demo/index.html': { body: '<html><body>doc</body></html>' },
    'artifacts/demo/original/Plan Q3.docx': { body: 'DOCX-BYTES' },
  };
  return createServeEnv({ assets, r2, deployment: { ...defaultDeployment, has_mobile: 0, mobile_entrypoint: '' } });
};

describe('asset paths with spaces', () => {
  it('serves original/Plan%20Q3.docx from the stored "original/Plan Q3.docx"', async () => {
    const { env } = withOriginal();
    const res = await handleServe(serveRequest('original/Plan%20Q3.docx'), env, SLUG, 'original/Plan%20Q3.docx');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('DOCX-BYTES');
  });

  it('a malformed escape does not throw and stays a miss', async () => {
    const { env } = withOriginal();
    const res = await handleServe(serveRequest('original/%E0%A4%A.docx'), env, SLUG, 'original/%E0%A4%A.docx');
    expect(res.status).toBe(404);
  });
});
