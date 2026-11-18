// Which Authentication-Results verdicts count: only the first header, and only when Cloudflare
// stamped it (authserv-id mx.cloudflare.net) — later ones may come from the sender.
import { describe, expect, it } from 'vitest';
import { cloudflareAuthResults, senderVerified } from '../../../src/email/inbound';

const h = (v: string) => new Headers({ 'authentication-results': v });

describe('cloudflareAuthResults', () => {
  it('reads dmarc (and the domain it was checked for), every dkim signature with its domain, and spf with the envelope it checked', () => {
    const a = cloudflareAuthResults(h('mx.cloudflare.net; dkim=pass header.d=sendgrid.net header.s=s1 header.b=abc; dkim=pass header.d=Acme.com; dmarc=pass header.from=acme.com policy.dmarc=none; spf=pass smtp.mailfrom=x@acme.com'));
    expect(a).toEqual({ dmarc: 'pass', dmarcFrom: 'acme.com', dkim: [{ result: 'pass', domain: 'sendgrid.net' }, { result: 'pass', domain: 'acme.com' }], spf: 'pass', spfMailFrom: 'x@acme.com' });
  });

  it('is null without a Cloudflare stamp', () => {
    expect(cloudflareAuthResults(h('mx.google.com; dkim=pass header.d=acme.com; dmarc=pass'))).toBeNull();
    expect(cloudflareAuthResults(new Headers())).toBeNull();
  });

  it('stops at the end of the first header; commas inside comments do not end it', () => {
    const a = cloudflareAuthResults(h('mx.cloudflare.net; spf=fail (mx.cloudflare.net: 1.2.3.4, 5.6.7.8 not permitted) smtp.mailfrom=a@acme.com; dmarc=none, evil.test; dmarc=pass; dkim=pass header.d=acme.com'));
    expect(a).toEqual({ dmarc: 'none', dmarcFrom: null, dkim: [], spf: 'fail', spfMailFrom: 'a@acme.com' });
  });

  it('takes the domain from header.i when header.d is missing', () => {
    expect(cloudflareAuthResults(h('mx.cloudflare.net; dkim=pass header.i=@mail.acme.com'))?.dkim).toEqual([{ result: 'pass', domain: 'mail.acme.com' }]);
  });
});

describe('senderVerified', () => {
  const cf = (v: string) => cloudflareAuthResults(h(v));
  it('DMARC pass vouches for the header From', () => {
    expect(senderVerified(cf('mx.cloudflare.net; dmarc=pass'), 'ana@acme.com')).toBe(true);
  });
  it('DKIM pass counts only for the From domain or a parent of it', () => {
    expect(senderVerified(cf('mx.cloudflare.net; dkim=pass header.d=acme.com; dmarc=none'), 'ana@acme.com')).toBe(true);
    expect(senderVerified(cf('mx.cloudflare.net; dkim=pass header.d=acme.com; dmarc=none'), 'ana@ventas.acme.com')).toBe(true);
    expect(senderVerified(cf('mx.cloudflare.net; dkim=pass header.d=ventas.acme.com; dmarc=none'), 'ana@acme.com')).toBe(false);
    expect(senderVerified(cf('mx.cloudflare.net; dkim=pass header.d=notacme.com; dmarc=none'), 'ana@acme.com')).toBe(false);
    expect(senderVerified(cf('mx.cloudflare.net; dkim=fail header.d=acme.com; dmarc=none'), 'ana@acme.com')).toBe(false);
    expect(senderVerified(cf('mx.cloudflare.net; dkim=pass; dmarc=none'), 'ana@acme.com')).toBe(false);
  });
  it('no stamp, no sender = not verified', () => {
    expect(senderVerified(null, 'ana@acme.com')).toBe(false);
    expect(senderVerified(cf('mx.cloudflare.net; dmarc=none'), '')).toBe(false);
  });
});
