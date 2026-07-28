import { ShareOutClient } from './client';
import { allowCreateAccount, loadToken } from './env';

let cachedEphemeralToken: string | null = null;

/** Reuse one ephemeral account per test run to avoid production create-account rate limits. */
export async function getFlowToken(): Promise<string> {
  const fromEnv = loadToken('primary');
  if (fromEnv) return fromEnv;

  if (cachedEphemeralToken) return cachedEphemeralToken;

  if (!allowCreateAccount) {
    throw new Error(
      'No credentials found. Add ~/.shareout/credentials, set SHAREOUT_E2E_TOKEN, or pass --create-account'
    );
  }

  const account = await ShareOutClient.anonymous().createAccount();
  cachedEphemeralToken = account.token;
  return cachedEphemeralToken;
}

export function getOutsiderToken(): string | null {
  return loadToken('secondary');
}
