# sdk.knowledge

Search the artifact's own workspace Knowledge (Files + pages) from the running page.

```js
const { hits } = await sdk.knowledge.search('inspection periodicity', { limit: 5 });
for (const h of hits) console.log(h.cite, h.source.title, h.source.url, h.locator, h.text);
```

Each hit: `text`, `locator`, `score`, `cite`, `url`, and `source: { kind, id, title, url }`. `limit` is 1-30 (default 10).

**Who can call it:** only a signed-in *internal* member of the artifact's workspace. Anonymous, public-link and external viewers get 401/403. Hits are filtered to documents that member can open (private pages/files owned by others never appear). Scope is always the artifact's own workspace; Knowledge must be enabled for it. Calls are metered as `knowledge_search`.

REST: `GET /v1/data/{artifactId}/knowledge/search?q=&limit=`.
