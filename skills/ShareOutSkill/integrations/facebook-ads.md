# Facebook Ads

Query Meta Marketing API data from inside an artifact via a **workspace connector**. Connect with a pasted long-lived access token plus your ad account ID — no ShareOut OAuth flow.

Load [../team/workspace-connections.md](../team/workspace-connections.md) for connector admin APIs.

## Setup (workspace admin)

1. In [Meta for Developers](https://developers.facebook.com/), create an app with Marketing API access and generate a long-lived user access token with `ads_read`.
2. Note your ad account ID (e.g. `act_123456789`).
3. In ShareOut → workspace **Connectors**, choose **Facebook Ads**, paste the token and account ID, and **Test** before saving.

## Query from an artifact

```javascript
const sdk = await ShareOut.create();

const { data } = await sdk.connection('meta_ads').fetch({
  endpoint: 'insights',
  params: {
    date_preset: 'last_30d',
    level: 'campaign',
    fields: 'campaign_name,spend,impressions,clicks,purchase_roas',
  },
});
```

The provider calls `graph.facebook.com/v21.0`. Credentials stay server-side; the artifact references the connector by name only.

## Rate limits

~200 requests/min per connection, with server-side caching (default 5 min TTL).

## Related

- [../team/workspace-connections.md](../team/workspace-connections.md) — create and test connectors
- [google-ads.md](google-ads.md) — similar token-shim pattern
- [overview.md](overview.md) — integration index
