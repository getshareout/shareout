// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { facebookAdsProvider } from '../../../../src/data/platform/providers/facebook-ads';
import { googleAdsProvider } from '../../../../src/data/platform/providers/google-ads';
import type { ExecutionContext } from '../../../../src/data/platform/types';

afterEach(() => vi.restoreAllMocks());

function ctx(config: Record<string, unknown>, credentials: Record<string, unknown>): ExecutionContext {
  return {
    artifactId: 'art_1',
    connectionId: 'conn_1',
    connectionConfig: { id: 'conn_1', name: 'c', provider: 'p', preferredMode: 'proxy', config, createdAt: '', updatedAt: '' },
    credentials: credentials as ExecutionContext['credentials'],
    env: {} as ExecutionContext['env'],
  };
}

describe('Facebook Ads provider', () => {
  it('hits the Graph API insights endpoint with a bearer token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ spend: '10' }] }), { status: 200 })
    );
    const ep = facebookAdsProvider.getEndpoint('insights')!;
    const res = await facebookAdsProvider.executeRequest(
      ctx({ account_id: '123456789' }, { access_token: 'TOK' }),
      ep,
      { queryParams: { date_preset: 'last_7d', fields: 'spend' } }
    );
    expect(res.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('https://graph.facebook.com/v21.0/act_123456789/insights');
    expect(String(url)).toContain('date_preset=last_7d');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer TOK');
  });

  it('fails clearly without an account id', async () => {
    const res = await facebookAdsProvider.executeRequest(
      ctx({}, { access_token: 'TOK' }),
      facebookAdsProvider.getEndpoint('insights')!,
      {}
    );
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('MISSING_ACCOUNT_ID');
  });
});

describe('Google Ads provider', () => {
  it('mints a token from the refresh token and sends developer-token + login-customer-id headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'ACCESS', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify([{ results: [] }]), { status: 200 });
    });

    const ep = googleAdsProvider.getEndpoint('search')!;
    const res = await googleAdsProvider.executeRequest(
      ctx(
        { customer_id: '123-456-7890', login_customer_id: '111-222-3333' },
        { extra: { authorized_user: { client_id: 'cid', client_secret: 'sec', refresh_token: 'rtok-unique-1' }, developer_token: 'DEV' } }
      ),
      ep,
      { body: { query: 'SELECT campaign.id FROM campaign' } }
    );

    expect(res.success).toBe(true);
    const adsCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('googleads.googleapis.com'))!;
    expect(String(adsCall[0])).toContain('/v17/customers/1234567890/googleAds:searchStream');
    const headers = adsCall[1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ACCESS');
    expect(headers['developer-token']).toBe('DEV');
    expect(headers['login-customer-id']).toBe('1112223333');
  });

  it('fails clearly without a developer token', async () => {
    const res = await googleAdsProvider.executeRequest(
      ctx({ customer_id: '123' }, { extra: { authorized_user: { client_id: 'c', client_secret: 's', refresh_token: 'r' } } }),
      googleAdsProvider.getEndpoint('search')!,
      { body: { query: 'x' } }
    );
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('MISSING_DEVELOPER_TOKEN');
  });
});
