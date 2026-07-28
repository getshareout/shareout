import { errorResponse } from './response';
import type { ActionHandler } from './types';

export function dispatchAction(
  action: string,
  handlers: Record<string, ActionHandler>
): Promise<Response> {
  const handler = handlers[action];
  if (!handler) {
    return Promise.resolve(errorResponse('INVALID_ACTION', `Unknown action: ${action}`, 400));
  }
  return handler();
}
