// Section anchors for headings that have no id. The corpus chunker (server, from the
// page's HTML) and the page agent (browser, from the live DOM inside the content frame)
// must derive the SAME anchor for the same heading, so both run this one function: the
// page agent embeds its source via toString(). Keep it self-contained — no imports, no
// helpers, no nested functions (bundlers may wrap those), and ASCII-only code (it runs
// inside artifact pages of any charset).
//
// "3.2 Clasificación de residuos" → "h-3-2-clasificacion-de-residuos"; a repeated
// heading on the same page gets -2, -3… in document order. Headings that slug to
// nothing (no Latin letters/digits) get '' (no anchor).
export function headingAnchors(texts: string[]): string[] {
  const seen: Record<string, boolean> = {};
  const out: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    const base = String(texts[i] || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 60).replace(/-+$/, '');
    if (!base) { out.push(''); continue; }
    let slug = 'h-' + base;
    for (let k = 2; seen[slug]; k++) slug = 'h-' + base + '-' + k;
    seen[slug] = true;
    out.push(slug);
  }
  return out;
}
