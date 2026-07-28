// Model pricing, expressed in micro-USD (1 USD = 1_000_000) per 1M tokens.
// Used to turn token usage into the dollar cost the instance owes its provider.

interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

const PRICES: Record<string, ModelPrice> = {
  'gpt-4o': { inputPerMTok: 2_500_000, outputPerMTok: 10_000_000 },
  // Claude models used by the Crew runtime (routed via the Vercel AI Gateway).
  'claude-sonnet-4.6': { inputPerMTok: 3_000_000, outputPerMTok: 15_000_000 },
  'claude-sonnet-4-20250514': { inputPerMTok: 3_000_000, outputPerMTok: 15_000_000 },
  'claude-3-5-haiku-20241022': { inputPerMTok: 800_000, outputPerMTok: 4_000_000 },
};

const DEFAULT_PRICE = PRICES['gpt-4o'];

function normalizeModel(model: string): string {
  return model.replace(/^(openai|anthropic)\//, '');
}

/** Raw model cost for the given token usage, in micro-USD. */
export function computeBaseCostMicroUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[normalizeModel(model)] ?? DEFAULT_PRICE;
  const input = (inputTokens * price.inputPerMTok) / 1_000_000;
  const output = (outputTokens * price.outputPerMTok) / 1_000_000;
  return Math.round(input + output);
}
