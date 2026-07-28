---
title: CORS Proxy
description: Server-side proxy for external APIs that don't send CORS headers.
---

Fetch external APIs from artifact JavaScript without CORS errors. ShareOut
proxies the request server-side and forwards the response.

## Quick start

```javascript
const sdk = await ShareOut.create();

// Per-artifact proxy (recommended)
const proxyUrl = `https://shareout.site/v1/data/${sdk.artifactId}/proxy`;
const response = await fetch(`${proxyUrl}?url=${encodeURIComponent('https://api.weather.gov/points/39.7456,-104.9910')}`);
const data = await response.json();
```

## When to use

| Scenario | Solution |
| --- | --- |
| API without CORS headers | Use the proxy |
| Public APIs (weather, crypto, etc.) | Use the proxy |
| API that already sends CORS headers | Direct `fetch` |
| Your own API | Add CORS headers on your server |

## Endpoints

**Per-artifact proxy** (isolated rate limits, configurable):

```
GET https://shareout.site/v1/data/{artifactId}/proxy?url=<encoded-url>
```

**Global proxy** (shared IP-based rate limit, no config):

```
GET https://shareout.site/api/proxy?url=<encoded-url>
```

```javascript
// Global proxy — simpler, no artifact context needed
const response = await fetch(
  `https://shareout.site/api/proxy?url=${encodeURIComponent('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd')}`
);
```

## Constraints

| Constraint | Value |
| --- | --- |
| Method | GET only |
| Rate limit | 100 req/min per artifact |
| Response size | 10 MB max |
| Timeout | 10 seconds |
| Cache TTL | 5 min default |

## Configuration (owner only)

```javascript
// Read current config
const config = await fetch(`/v1/data/${artifactId}/proxy/config`, {
  headers: { 'Authorization': `Bearer ${token}` },
}).then(r => r.json());

// Update config
await fetch(`/v1/data/${artifactId}/proxy/config`, {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    enabled: true,
    allowed_hosts: ['api.weather.gov', 'api.coingecko.com'],
    blocked_hosts: ['internal.company.com'],
    cache_ttl: 600,
    max_requests_per_minute: 50,
  }),
});
```

## Config fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Enable or disable the proxy for this artifact |
| `allowed_hosts` | string[] | `null` | Allowlist — `null` means any host |
| `blocked_hosts` | string[] | `null` | Blocklist |
| `cache_ttl` | number | `300` | Cache TTL in seconds (0–3600) |
| `max_requests_per_minute` | number | `100` | Rate limit (1–1000) |

## Response headers

| Header | Description |
| --- | --- |
| `X-Proxy-Cache` | `HIT` or `MISS` |
| `X-RateLimit-Remaining` | Requests remaining in the current window |

## Security

Blocked automatically:

- Internal IPs: `127.0.0.1`, `localhost`, `10.x`, `192.168.x`, `169.254.x`
- Schemes: `file://`, `javascript:`, `data:`
- `Set-Cookie` headers are stripped from responses

## Errors

| Code | Meaning |
| --- | --- |
| `BLOCKED_DESTINATION` | Internal IP or disallowed scheme |
| `HOST_NOT_ALLOWED` | Host not in `allowed_hosts` |
| `PROXY_RATE_LIMITED` | Rate limit exceeded |
| `FILE_TOO_LARGE` | Response exceeds 10 MB |
| `PROXY_ERROR` | Upstream request failed |
