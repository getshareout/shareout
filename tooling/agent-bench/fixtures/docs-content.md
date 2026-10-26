# Relay CLI — documentation source (synthetic product)

Relay is a fictional command-line tool that syncs folders to object storage.

## Getting started
Install with `brew install relay-cli` or download the binary. Run `relay init` in a folder;
it writes `relay.toml`. Then `relay login` opens the browser to authorize.

## Configuration
`relay.toml` keys: `bucket` (required), `prefix` (default ""), `exclude` (glob list),
`concurrency` (default 4, max 32), `delete_remote` (default false).
Environment overrides: `RELAY_BUCKET`, `RELAY_CONCURRENCY`.

## Commands
- `relay sync` — one-way upload of changed files; `--dry-run` prints the plan
- `relay watch` — sync continuously; debounce 2 s
- `relay status` — last sync time, pending files, errors
- `relay restore <path> --at <timestamp>` — restore a file version

## Troubleshooting
- "403 AccessDenied": the token lacks write permission on the bucket; run `relay login` again
- Slow syncs: raise `concurrency`; exclude `node_modules` and build folders
- Clock skew errors: sync the system clock (signatures expire after 15 minutes)

## FAQ
- Does Relay delete remote files? Only with `delete_remote = true`.
- Is data encrypted? In transit (TLS) and at rest by the storage provider.
- Windows support? Yes, from version 0.9.
