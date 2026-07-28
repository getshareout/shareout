# Integration: CORS Proxy

Server-side proxy for external APIs without CORS headers.

## When to Use

| Scenario | Solution |
|----------|----------|
| API without CORS | Use proxy |
| Public weather/crypto APIs | Use proxy |
| API with CORS headers | Direct fetch |
| Your own API | Configure CORS on server |

## Endpoints

**Global Proxy** (IP rate limited):
```
GET $ORIGIN/api/proxy?url=<encoded-url>
```

**Per-Artifact Proxy** (configurable):
```
GET $ORIGIN/v1/data/{artifactId}/proxy?url=<encoded-url>
```

## Usage

```javascript
const sdk = new ShareOut();
const proxyUrl = `$ORIGIN/v1/data/${sdk.artifactId}/proxy`;
const apiUrl = 'https://api.weather.gov/points/39.7456,-104.9910';

const response = await fetch(`${proxyUrl}?url=${encodeURIComponent(apiUrl)}`);
const data = await response.json();
```

## Global Proxy (Simpler)

```javascript
const apiUrl = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';
const response = await fetch(`$ORIGIN/api/proxy?url=${encodeURIComponent(apiUrl)}`);
const btcPrice = await response.json();
```

## Configuration (Owner Only)

```javascript
// Get config
const config = await fetch(`/v1/data/${artifactId}/proxy/config`, {
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json());

// Update config
await fetch(`/v1/data/${artifactId}/proxy/config`, {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    enabled: true,
    allowed_hosts: ['api.weather.gov', 'api.coingecko.com'],
    blocked_hosts: ['internal.company.com'],
    cache_ttl: 600,
    max_requests_per_minute: 50
  })
});
```

## Config Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | true | Enable/disable proxy |
| `allowed_hosts` | string[] | null | Whitelist (null = all) |
| `blocked_hosts` | string[] | null | Blocklist |
| `cache_ttl` | number | 300 | Cache seconds (0-3600) |
| `max_requests_per_minute` | number | 100 | Rate limit (1-1000) |

## Constraints

| Constraint | Value |
|------------|-------|
| Method | GET only |
| Rate limit | 100 req/min per artifact |
| Response size | 10 MB max |
| Timeout | 10 seconds |
| Cache TTL | 5 min default |

## Security

**Blocked IPs:**
- `127.0.0.1`, `localhost`
- Private ranges (`10.x`, `192.168.x`, `169.254.x`)

**Blocked schemes:**
- `file://`, `javascript:`, `data:`

**Sanitized:**
- `Set-Cookie` headers stripped

## Response Headers

| Header | Description |
|--------|-------------|
| `X-Proxy-Cache` | `HIT` or `MISS` |
| `X-RateLimit-Remaining` | Requests left |

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `BLOCKED_DESTINATION` | 403 | Internal IP or scheme |
| `HOST_NOT_ALLOWED` | 403 | Not in allowlist |
| `PROXY_RATE_LIMITED` | 429 | Rate limit exceeded |
| `FILE_TOO_LARGE` | 413 | Response > 10MB |
| `PROXY_ERROR` | 502 | Upstream failed |

## Best Practices

1. **Cache client-side** - Use `sdk.json` to store responses
2. **Use per-artifact proxy** - Isolated limits
3. **Whitelist hosts** - Set `allowed_hosts` for production
4. **Handle errors** - Show cached data on failure

## Related

- [Overview](overview.md) - All integrations
