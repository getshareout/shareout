import versions from '../public/_bundles/versions.json';

// Content hashes of the first-party bundles, staged by scripts/stage-bundle-versions.mjs.
const BUNDLE_VERSIONS: Record<string, string> = versions;

/** `<path>?v=<hash>` for a first-party bundle, so its bytes can be cached immutably. */
export function versionedBundlePath(path: string): string {
  const v = BUNDLE_VERSIONS[path];
  return v ? `${path}?v=${v}` : path;
}

/** True when `v` names this deploy's bytes for `path` (an old or missing hash is not). */
export function isCurrentBundleVersion(path: string, v: string | null): boolean {
  return !!v && BUNDLE_VERSIONS[path] === v;
}
