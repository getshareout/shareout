---
title: Quickstart
description: Publish your first page in under a minute on your instance.
---

import { Steps } from '@astrojs/starlight/components';

Publish a live page with one request against **your** `$ORIGIN`. You'll need an
API token — see [Authentication](/start/authentication/). No instance yet?
[Install first](/self-host/overview/).

<Steps>

1. **Save credentials.** Put token **and origin** in `~/.shareout/credentials`:

   ```json title="~/.shareout/credentials"
   {
     "token": "so_your_token_here",
     "origin": "https://shareout.<your-account>.workers.dev"
   }
   ```

2. **Publish a page.** ShareOut sits behind Cloudflare, which can block raw
   Python `requests`. The reliable pattern is to build the JSON in Python and
   pipe it to `curl`:

   ```bash
   ORIGIN=$(python3 -c "import json,os; print(json.load(open(os.path.expanduser('~/.shareout/credentials')))['origin'].rstrip('/'))")
   TOKEN=$(python3 -c "import json,os; print(json.load(open(os.path.expanduser('~/.shareout/credentials')))['token'])")

   python3 - <<'PY' | curl -sS -X POST "$ORIGIN/v1/publish" \
     -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     --data-binary @-
   import json, sys
   json.dump({
     "name": "Hello ShareOut",
     "slug": "hello-shareout",
     "visibility": "public",
     "files": [{
       "path": "index.html",
       "content": "<!DOCTYPE html><html><body><h1>Hello, world.</h1></body></html>",
       "mime": "text/html",
       "encoding": "utf8"
     }]
   }, sys.stdout)
   PY
   ```

3. **Open your URL.** The response includes the live link on **your** origin:

   ```json
   {
     "artifact": { "id": "art_abc123" },
     "deployment": {
       "slug": "hello-shareout",
       "url": "https://shareout.<your-account>.workers.dev/a/hello-shareout/"
     }
   }
   ```

</Steps>

That's it — your page is live. Update it any time by publishing again with the
same `slug`; ShareOut creates a new version and keeps the old ones.

## Next steps

- [Give your page data](/guides/data/) — JSON, tables, and file blobs.
- [Put it on a schedule](/guides/jobs/) — email, Slack, webhooks.
- Browse the full [REST API reference](/api/).
