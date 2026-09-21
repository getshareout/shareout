// Live model catalog from the Vercel AI Gateway, so the workspace/instance model picker
// never needs a hardcoded list. GET https://ai-gateway.vercel.sh/v1/models is public and
// unauthenticated, and follows the OpenAI /v1/models response shape.
import { fetchWithTimeout } from '../../fetch-utils';

const GATEWAY_MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models';
const FETCH_TIMEOUT_MS = 8000;

export interface GatewayModelOption {
  id: string;
  name: string;
  ownedBy: string;
  contextWindow: number | null;
}

interface GatewayModelsResponse {
  data?: Array<{
    id: string;
    name?: string;
    owned_by?: string;
    type?: string;
    context_window?: number;
    supported_parameters?: string[];
    tags?: string[];
  }>;
}

function supportsTools(m: NonNullable<GatewayModelsResponse['data']>[number]): boolean {
  return Boolean(m.supported_parameters?.includes('tools') || m.tags?.includes('tool-use'));
}

/** Language models the gateway serves that support tool calling — every chat/crew
 *  request this app sends includes `tools`, so a model without it would silently fail. */
export async function fetchGatewayModels(): Promise<GatewayModelOption[]> {
  const response = await fetchWithTimeout(GATEWAY_MODELS_URL, {}, FETCH_TIMEOUT_MS);
  if (!response.ok) throw new Error(`Vercel AI Gateway catalog HTTP ${response.status}`);
  const body = (await response.json()) as GatewayModelsResponse;

  return (body.data ?? [])
    .filter((m) => m.type === 'language' && supportsTools(m))
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      ownedBy: m.owned_by || m.id.split('/')[0] || '',
      contextWindow: m.context_window ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
