export interface NamespacedPath {
  workspaceSlug: string;
  folderPath: string;
  artifactSlug: string;
  assetPath: string;
}

export function parseNamespacedPath(path: string): NamespacedPath | null {
  const namespacedMatch = path.match(/^\/@([^/]+)\/(.+)$/);
  if (!namespacedMatch) return null;

  const [, workspaceSlug, rawRest] = namespacedMatch;
  const rest = rawRest.replace(/\/+$/, '');
  if (!rest) return null;
  const parts = rest.split('/');
  if (parts.length < 1) return null;

  let artifactSlug: string;
  let folderPath: string;
  let assetPath: string;

  const assetStartIdx = parts.findIndex((p) => p.includes('.') || p === '_text');

  if (assetStartIdx === -1) {
    artifactSlug = parts[parts.length - 1];
    folderPath = parts.slice(0, -1).join('/');
    assetPath = '';
  } else if (assetStartIdx === 0) {
    artifactSlug = parts[0];
    folderPath = '';
    assetPath = parts.slice(1).join('/');
  } else {
    artifactSlug = parts[assetStartIdx - 1];
    folderPath = parts.slice(0, assetStartIdx - 1).join('/');
    assetPath = parts.slice(assetStartIdx).join('/');
  }

  return { workspaceSlug, folderPath, artifactSlug, assetPath };
}
