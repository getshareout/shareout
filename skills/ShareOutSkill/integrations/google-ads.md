# Google Ads

Query Google Ads API data from inside an artifact via a **workspace connector**. Connect with a pasted OAuth client ID/secret, refresh token, developer token, and customer ID — ShareOut mints access tokens server-side per query.

Load [../team/workspace-connections.md](../team/workspace-connections.md) for connector admin APIs.

## Setup (workspace admin)

1. Obtain a [Google Ads developer token](https://developers.google.com/google-ads/api/docs/get-started/dev-token) (test or production).
2. Create OAuth credentials and authorize a user with access to the target customer account. Save the refresh token.
3. In ShareOut → workspace **Connectors**, choose **Google Ads**, paste all required fields, and **Test** before saving.

Customer IDs are 10 digits; dashed forms (`123-456-7890`) are accepted.

## Query from an artifact

```javascript
const sdk = await ShareOut.create();

const { data } = await sdk.connection('google_ads').fetch({
  endpoint: 'search',
  body: {
    query: `SELECT campaign.name, metrics.cost_micros, metrics.clicks
            FROM campaign
            WHERE segments.date DURING LAST_30_DAYS`,
  },
});
```

The provider calls `googleads.googleapis.com`. Credentials never reach the browser.

## Rate limits

~60 requests/min per connection, with server-side caching (default 5 min TTL).

## Related

- [../team/workspace-connections.md](../team/workspace-connections.md) — create and test connectors
- [facebook-ads.md](facebook-ads.md) — similar token-shim pattern
- [overview.md](overview.md) — integration index
