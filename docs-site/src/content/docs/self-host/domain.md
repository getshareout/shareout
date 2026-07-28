---
title: Domain and DNS
description: Custom domains, workers.dev, and workspace wildcard subdomains for self-hosted ShareOut.
---

ShareOut only needs one correct public origin: **`SHAREOUT_BASE_URL`**. Everything
(links, OAuth callbacks, skill URLs, SDK) should hang off that origin unless you
explicitly set `ARTIFACT_ORIGIN`.

## Default: workers.dev

After deploy you get something like:

```text
https://shareout.<account-subdomain>.workers.dev
```

Set:

```toml
SHAREOUT_BASE_URL = "https://shareout.<account-subdomain>.workers.dev"
```

No DNS work required. Good for trying the product.

## Custom domain (company URL)

1. In Cloudflare: **Workers & Pages → your worker → Domains & Routes → Add** a custom
   domain (for example `shareout.company.com`).
2. Complete DNS as the dashboard instructs (domain should be on Cloudflare).
3. Update `SHAREOUT_BASE_URL` to `https://shareout.company.com` (no trailing slash).
4. Redeploy or save vars and roll a new deployment.
5. If Google sign-in is enabled, set the OAuth redirect to
   `{SHAREOUT_BASE_URL}/auth/callback`.

Cloudflare docs:
[Custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## Workspace subdomains

Optional. Path URLs (`/a/{slug}/`) always work without wildcards.

For `https://{workspace}.{apex}/…`:

1. Keep apex = `SHAREOUT_BASE_URL` host.
2. Add wildcard DNS for the same Worker (for example `*.shareout.company.com`).
3. Ensure the certificate covers the wildcard.
4. Configure the workspace subdomain in the product UI.

## Agent checklist

Agents should follow
[skills/ShareOutSkill/deploy/cloudflare.md](https://github.com/getshareout/shareout/blob/main/skills/ShareOutSkill/deploy/cloudflare.md)
and load **wrangler** + **cloudflare** companion skills when available.

## After any hostname change

1. `SHAREOUT_BASE_URL` matches the browser address bar origin.
2. Re-smoke: `SHAREOUT_ORIGIN=… SHAREOUT_TOKEN=… npm run smoke:hello`.
3. Update `~/.shareout/credentials` `"origin"` for agents.
