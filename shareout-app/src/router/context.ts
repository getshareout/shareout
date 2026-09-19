import type { Env } from '../types';
import { addCORSHeaders } from '../cors';
import type { RoutedDeployment } from '../serve/deployment-cache';

export interface FetchContext {
  request: Request;
  env: Env;
  url: URL;
  path: string;
  hostname: string;
  addCORS: (response: Response) => Response;
  /** Worker ExecutionContext — use waitUntil() to run work past the response. */
  executionCtx?: ExecutionContext;
  /** Deployment already resolved by the subdomain shorthand rewrite, if any. */
  deployment?: RoutedDeployment;
}

export function createFetchContext(request: Request, env: Env, executionCtx?: ExecutionContext): FetchContext {
  const url = new URL(request.url);
  return {
    request,
    env,
    url,
    path: url.pathname,
    hostname: url.hostname,
    addCORS: (response) => addCORSHeaders(response, request, env),
    executionCtx,
  };
}
