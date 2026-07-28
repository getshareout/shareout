export function isLocalRequest(request: Request, hostname: string): boolean {
  const hostHeader = request.headers.get('Host') || '';
  return (
    request.headers.get('cf-connecting-ip') === '127.0.0.1' ||
    request.headers.get('cf-connecting-ip') === '::1' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.localhost') ||
    hostHeader.startsWith('localhost:') ||
    hostHeader.startsWith('127.0.0.1:') ||
    hostHeader.startsWith('0.0.0.0:') ||
    hostHeader === 'localhost' ||
    hostHeader === '127.0.0.1' ||
    hostHeader === '0.0.0.0'
  );
}
