/**
 * Artifacts arrive with the skill docs' `$ORIGIN` placeholder still in their tags
 * when the authoring agent never substituted it. The URL then resolves against the
 * artifact's own path (`<hex>.shareoutcdn.site/c/<ct>/$ORIGIN/sdk/shareout.js`),
 * 404s, and the page is dead on arrival with "ShareOut is not defined".
 *
 * `/sdk/`, `/lib/` and `/vendor/` are served on every host an artifact runs on
 * (see router/shared-bundles.ts), so dropping the placeholder leaves a root-relative
 * path that is correct everywhere. Anything else keeps the placeholder and is
 * reported back to the publisher instead of failing silently at view time.
 */

const PLACEHOLDER = String.raw`\$\{ORIGIN\}|\$ORIGIN_HOST|\$ORIGIN|\{\{ORIGIN\}\}|\{ORIGIN\}`;

// Quoted only, so a placeholder an artifact merely prints as documentation text is
// left alone — same rule as the vendor CDN rewrite.
const SHARED_BUNDLE_URL = new RegExp(
  String.raw`(["'])(?:${PLACEHOLDER})(/(?:sdk|lib|vendor)/[^"'\s<>]*)\1`,
  'g',
);

const ANY_PLACEHOLDER = new RegExp(PLACEHOLDER);

export interface PlaceholderFix {
  html: string;
  /** Shared-bundle URLs made root-relative. */
  rewritten: number;
  /** A placeholder we could not resolve is still in the markup. */
  unresolved: boolean;
}

export function stripOriginPlaceholders(html: string): PlaceholderFix {
  let rewritten = 0;
  const out = html.replace(SHARED_BUNDLE_URL, (_whole, quote: string, path: string) => {
    rewritten++;
    return `${quote}${path}${quote}`;
  });
  return { html: out, rewritten, unresolved: ANY_PLACEHOLDER.test(out) };
}

export function placeholderWarnings(fix: PlaceholderFix): string[] {
  const warnings: string[] = [];
  if (fix.rewritten > 0) {
    warnings.push(
      `Rewrote ${fix.rewritten} unresolved $ORIGIN URL${fix.rewritten === 1 ? '' : 's'} to root-relative paths. ` +
        'Inside published HTML, load shared bundles as "/sdk/shareout.js" — the artifact\'s own host serves them.',
    );
  }
  if (fix.unresolved) {
    warnings.push(
      'The published HTML still contains an unresolved $ORIGIN placeholder. ' +
        'Substitute your instance origin before publishing — it will 404 at view time.',
    );
  }
  return warnings;
}
