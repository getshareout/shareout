/** The first of `names` present on `url` whose value is not a non-negative integer, else null. */
export function invalidIntParam(url: URL, ...names: string[]): string | null {
  for (const name of names) {
    const v = url.searchParams.get(name);
    if (v && !/^\d+$/.test(v)) return name;
  }
  return null;
}
