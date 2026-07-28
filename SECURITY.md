# Security Policy

ShareOut is maintained by one person ([@leorfer23](https://github.com/leorfer23)). There is
no security team and no on-call rotation — please read the expectations below before reporting.

## Supported versions

Report vulnerabilities against the latest `main` of this repository. There are no
backported security releases for older commits.

## Reporting a vulnerability

**Do not open a public GitHub issue for security bugs.**

Use GitHub's private reporting form:
**[Report a vulnerability](https://github.com/getshareout/shareout/security/advisories/new)**
(repo → Security → Report a vulnerability). It is private to the maintainer until a fix ships.

Include:

- A description of the issue and its impact
- Steps to reproduce (PoC if available)
- Affected component (Worker, SDK, editor, docs) if known

Best-effort acknowledgement within about a week. Please allow reasonable time for a fix
before public disclosure; there is no bug bounty.

## Self-hosted instances

You run your own deployment, so you own its incident response: rotate any secrets that may
have been exposed (`SESSION_SECRET`, OAuth client secrets, connector credentials) and pull
the fix from `main`.
