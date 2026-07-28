import type { Env } from '../types';

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

/** Count exceededMemory invocations in [hourStart, hourStart+1h). Null when CF API is unavailable. */
export async function countExceededMemoryKills(
  env: Env,
  hourStart: Date,
  scriptName = 'shareout'
): Promise<number | null> {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return null;

  const since = hourStart.toISOString();
  const until = new Date(hourStart.getTime() + 3_600_000).toISOString();
  const query = `
    query MemoryKills($tag: String!, $since: Time!, $until: Time!, $script: String!) {
      viewer {
        accounts(filter: { accountTag: $tag }) {
          workersInvocationsAdaptive(
            limit: 10000
            filter: { datetime_geq: $since, datetime_lt: $until, scriptName: $script }
          ) {
            sum { requests }
            dimensions { status }
          }
        }
      }
    }`;

  try {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { tag: env.CF_ACCOUNT_ID, since, until, script: scriptName },
      }),
    });
    const json = (await res.json()) as {
      errors?: Array<{ message?: string }>;
      data?: { viewer?: { accounts?: Array<{ workersInvocationsAdaptive?: Array<{ sum?: { requests?: number }; dimensions?: { status?: string } }> }> } };
    };
    if (!res.ok || json.errors?.length) return null;

    const rows = json.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
    return rows
      .filter((row) => row?.dimensions?.status === 'exceededMemory')
      .reduce((total, row) => total + (Number(row?.sum?.requests) || 0), 0);
  } catch {
    return null;
  }
}
