# Workspace Custom Domains

A workspace can serve on a hostname its customer owns (`portal.acme.example`), as a full
mirror of its `{workspace}.{apex}` subdomain: home, artifacts, sign-in, API. When a custom
domain is the workspace's **primary**, share links, publish `url`s and invite emails use it.

Load [SKILL.md](SKILL.md) first. Roles: workspace `owner` or `admin` only.

## Is it on?

`GET $ORIGIN/v1/workspaces/{id}/domains` → `{ enabled, mode, cname_target, domains[] }`.

- `enabled: false` → the instance operator has not turned the feature on. Tell the user
  to ask whoever runs ShareOut; do not improvise DNS. (Operator: set
  `CUSTOM_DOMAINS_CNAME_TARGET`, plus `CF_CUSTOM_HOSTNAMES_TOKEN` +
  `CF_CUSTOM_HOSTNAMES_ZONE_ID` for Cloudflare for SaaS — see
  [../deploy/cloudflare.md](../deploy/cloudflare.md).)
- `mode: "cloudflare"` → Cloudflare verifies and issues HTTPS.
- `mode: "manual"` → ShareOut checks a `_shareout-verify.<host>` TXT record; the
  operator also routes the hostname to the Worker.

## Add → DNS → verify → primary

```bash
curl -sS -X POST "$ORIGIN/v1/workspaces/$WS/domains" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"hostname":"portal.acme.example"}'
```

The response `domain` has `status: "pending"`, `dns[]` (a `CNAME` to `cname_target` and a
`TXT` verification record) and `instructions[]`. Give the user those records **exactly**
and in plain words ("add these two records at whoever hosts acme.example's DNS"). Then:

```bash
curl -sS -X POST "$ORIGIN/v1/workspaces/$WS/domains/$DOMAIN_ID/refresh" -H "Authorization: Bearer $TOKEN"
```

Repeat every minute or two until `status` is `active` (DNS can take a while; don't loop
fast). `failed` → read `last_error`, fix DNS, refresh again. Then, if the user wants links
to use it:

```bash
curl -sS -X PATCH "$ORIGIN/v1/workspaces/$WS/domains/$DOMAIN_ID" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"primary":true}'
```

Remove: `DELETE $ORIGIN/v1/workspaces/$WS/domains/$DOMAIN_ID` (stops serving at once).

## Errors

| `code` | Meaning |
|---|---|
| `HOSTNAME_TAKEN` | Live on another workspace. Only that workspace can release it. |
| `HOSTNAME_CLAIMED` | Another workspace has an unverified claim (< 7 days old). |
| `HOSTNAME_NOT_ALLOWED` | The instance's own hostnames, workers.dev, etc. |
| `DOMAIN_NOT_ACTIVE` | Primary needs an `active` domain. |
| `DOMAIN_LIMIT` | 10 per workspace. |
| `CUSTOM_DOMAINS_DISABLED` | Feature off on this instance. |
| `DOMAIN_PROVIDER_ERROR` | Cloudflare/DNS call failed; retry later, then file a ticket. |

## Notes

- Use a subdomain (`portal.acme.example`); most DNS hosts refuse a CNAME on a bare domain.
- Pending or failed hostnames serve nothing (404), never another workspace.
- Sign-in on a custom domain hops through the instance login and back with a one-time
  code; people sign in once per hostname.
- Inside artifacts keep links relative so pages work on every host.
