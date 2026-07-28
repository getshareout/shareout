import { artifactStylesheet } from './design-system/artifact-css';
import { SDK_IMMUTABLE_CACHE } from './sdk-version';

/** Strip comments and collapse whitespace. gzip handles the rest. */
function minifyCSS(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{}:;,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/\n+/g, '\n')
    .trim();
}

const STYLESHEET = minifyCSS(artifactStylesheet);

export function handleServeArtifactCSS(request: Request, immutable = false): Response {
  const secFetchDest = request.headers.get('Sec-Fetch-Dest');
  const secFetchMode = request.headers.get('Sec-Fetch-Mode');

  if (secFetchDest === 'document' || secFetchMode === 'navigate') {
    return new Response('Forbidden', { status: 403 });
  }

  return new Response(STYLESHEET, {
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': immutable ? SDK_IMMUTABLE_CACHE : 'public, max-age=300, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
