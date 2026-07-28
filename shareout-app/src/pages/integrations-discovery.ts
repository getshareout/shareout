// integrations.sh + agent-skills discovery files for the public apex.
// Served by routeServe on the instance apex only (not workspace subdomains).
//
// Every URL here is derived from SHAREOUT_BASE_URL: these documents tell agents
// where to publish, so a self-hosted instance advertising the founder host would
// send its users' content to the wrong server. Only docs.shareout.site stays
// fixed — the project documentation is a shared resource, not per-instance.

import openapiSpec from '../discovery/openapi.spec.json';
import {
  AGENT_SKILL_ARCHIVE_DIGEST,
  AGENT_SKILL_DESCRIPTION,
  AGENT_SKILL_DIGEST,
  AGENT_SKILL_MD,
  AGENT_SKILL_NAME,
} from '../discovery/agent-skill.generated';
import type { Env } from '../types';
import { getPlatformHostname, getPlatformOrigin } from '../config/origins';
import { rewriteSkillOrigin, skillOriginRewriter } from '../skill-origin';
import { sha256 } from '../crypto-utils';

const JSON_CACHE = 'public, max-age=3600';

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': JSON_CACHE,
  'Access-Control-Allow-Origin': '*',
};

function declaredBasis(apex: string) {
  return { via: 'declared' as const, source: `${apex}/.well-known/integrations.json` };
}

/** v3 owner declaration for integrations.sh */
export function serveIntegrationsJson(env: Env): Response {
  const APEX = getPlatformOrigin(env);
  const host = getPlatformHostname(env);
  const declared = () => declaredBasis(APEX);
  const body = {
    version: 3,
    summary:
      'ShareOut is an AI-native publishing platform. Agents and developers publish live HTML artifacts (dashboards, decks, tools, forms) with backing data via a REST API, load the agent skill at /v1/skill, and embed interactive apps with the browser SDK at /sdk/shareout.js.',
    credentials: {
      shareout_personal_token: {
        type: 'api_key',
        label: 'ShareOut personal API token',
        generateUrl: `${APEX}/home`,
        setup:
          `Sign in at ${host}` +
          ', open **Home → Settings → API tokens**, and create a token (prefix `so_`). Store it in `~/.shareout/credentials` as `{ "token": "so_..." }`. Send as `Authorization: Bearer so_...` on REST and Data API calls. Browser sessions (`shareout_session` cookie from Google sign-in) also work for interactive use.',
      },
      shareout_agent_token: {
        type: 'api_key',
        label: 'ShareOut workspace Agent token',
        generateUrl: 'https://docs.shareout.site/team/agent-tokens',
        setup:
          '**Teams / Enterprise.** A workspace owner or admin mints a scoped service token (prefix `sot_`) via `POST /v1/workspaces/{workspace_id}/agent-tokens`. Plaintext is shown once. Send as the same `Authorization: Bearer` header; scopes confine publish and data access to one workspace.',
      },
    },
    surfaces: [
      {
        slug: 'shareout-api',
        name: 'ShareOut REST API',
        type: 'http',
        docs: 'https://docs.shareout.site/api',
        spec: `${APEX}/openapi.json`,
        url: APEX,
        basis: declared(),
        auth: {
          status: 'required',
          entries: [
            {
              use: [
                {
                  id: 'shareout_personal_token',
                  mechanics: {
                    source: 'http',
                    in: 'header',
                    headerName: 'Authorization',
                    scheme: 'Bearer',
                  },
                },
              ],
              basis: declared(),
            },
            {
              use: [
                {
                  id: 'shareout_agent_token',
                  mechanics: {
                    source: 'http',
                    in: 'header',
                    headerName: 'Authorization',
                    scheme: 'Bearer',
                  },
                },
              ],
              basis: declared(),
            },
          ],
        },
      },
      {
        slug: 'shareout-agent-skill',
        name: 'ShareOut Agent Skill',
        type: 'http',
        docs: `${APEX}/v1/skill/SKILL.md`,
        url: `${APEX}/v1/skill`,
        basis: declared(),
        auth: {
          status: 'none',
          basis: declared(),
        },
      },
    ],
  };

  return new Response(JSON.stringify(body), { headers: JSON_HEADERS });
}

/** OpenAPI 3.1 spec — canonical path integrations.sh probes first. */
export function serveOpenApiJson(env: Env): Response {
  // The spec's `servers` entry is where a generated client will send requests.
  const spec = JSON.parse(rewriteSkillOrigin(JSON.stringify(openapiSpec), env));
  return new Response(JSON.stringify(spec), { headers: JSON_HEADERS });
}

/** Agent Skills discovery index (Cloudflare / agentskills.io v0.2.0). */
export async function serveAgentSkillsIndex(env: Env): Promise<Response> {
  const APEX = getPlatformOrigin(env);
  const rewrite = skillOriginRewriter(env);
  const description = rewrite ? rewrite(AGENT_SKILL_DESCRIPTION) : AGENT_SKILL_DESCRIPTION;

  // A digest has to describe the bytes *this* instance serves. Unrewritten, the
  // build-time ones are exact and free. Rewritten, the SKILL.md digest is cheap to
  // recompute; the zip's would mean rebuilding the whole bundle on a discovery
  // request, so it is dropped rather than published wrong — a stale digest makes
  // agents reject a download that is actually correct.
  const skills: Array<Record<string, string>> = [
    {
      name: AGENT_SKILL_NAME,
      type: 'skill-md',
      description,
      url: `${APEX}/.well-known/agent-skills/${AGENT_SKILL_NAME}/SKILL.md`,
      digest: rewrite
        ? `sha256:${await sha256(new TextEncoder().encode(rewrite(AGENT_SKILL_MD)).buffer as ArrayBuffer)}`
        : AGENT_SKILL_DIGEST,
    },
    {
      name: `${AGENT_SKILL_NAME}-bundle`,
      type: 'archive',
      description: `${description} Full skill bundle (zip).`,
      url: `${APEX}/v1/skill`,
      ...(rewrite ? {} : { digest: AGENT_SKILL_ARCHIVE_DIGEST }),
    },
  ];

  return new Response(
    JSON.stringify({ $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json', skills }),
    { headers: JSON_HEADERS }
  );
}

/** Well-known copy of SKILL.md — bytes must match the index digest. */
export function serveAgentSkillMd(env: Env): Response {
  return new Response(rewriteSkillOrigin(AGENT_SKILL_MD, env), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': JSON_CACHE,
      'Access-Control-Allow-Origin': '*',
    },
  });
}
