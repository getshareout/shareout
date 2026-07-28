import { errorResponse, type DataContext } from '../middleware';

export async function handleWebSocket(request: Request, ctx: DataContext): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return errorResponse({ code: 'UPGRADE_REQUIRED', message: 'WebSocket upgrade required', status: 426 });
  }

  const id = ctx.env.REALTIME.idFromName(`slides:${ctx.artifactId}`);
  const stub = ctx.env.REALTIME.get(id);
  return stub.fetch(request);
}

