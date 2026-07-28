import { artifactUIScript } from './design-system/artifact-ui';
import { SDK_IMMUTABLE_CACHE } from './sdk-version';

export function handleServeArtifactUI(request: Request, immutable = false): Response {
  const secFetchDest = request.headers.get('Sec-Fetch-Dest');
  const secFetchMode = request.headers.get('Sec-Fetch-Mode');

  if (secFetchDest === 'document' || secFetchMode === 'navigate') {
    return new Response('Forbidden', { status: 403 });
  }

  return new Response(artifactUIScript, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': immutable ? SDK_IMMUTABLE_CACHE : 'public, max-age=300, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
