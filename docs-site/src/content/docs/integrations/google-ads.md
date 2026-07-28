---
title: Google Ads
description: Campaign spend, clicks, and conversions via a workspace connector and pasted OAuth credentials.
---

Query Google Ads API data from inside an artifact via a **workspace connector**.
Connect with a pasted OAuth client ID/secret, refresh token, developer token,
and customer ID — ShareOut mints access tokens server-side per query.

## Setup (workspace admin)

1. Obtain a [Google Ads developer token](https://developers.google.com/google-ads/api/docs/get-started/dev-token)
   (test or production).
2. Create OAuth credentials and authorize a user with access to the target
   customer account. Save the refresh token.
3. In ShareOut → workspace **Connectors**, choose **Google Ads**, paste all
   required fields, and **Test** before saving.

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

The provider calls `googleads.googleapis.com`. Credentials never reach the
browser.

## Rate limits

~60 requests/min per connection, with server-side caching (default 5 min TTL).

## Related

- [Workspace connections](/teams/connections/)
- [Facebook Ads](/integrations/facebook-ads/)
