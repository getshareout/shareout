// Verify — open a published artifact the way its viewers get it (desktop + phone),
// and report what they see and what broke. Shapes shared by the runner, the report
// builder, the REST routes and the MCP tool.

export type Viewport = 'desktop' | 'mobile';
export type Severity = 'error' | 'warning' | 'info';
export type VerifyStatus = 'pass' | 'warn' | 'fail' | 'partial';
export type CheckKind = 'render' | 'console' | 'network' | 'a11y' | 'layout' | 'design' | 'performance' | 'source';

export interface ViewportSpec {
  name: Viewport;
  width: number;
  height: number;
  dpr: number;
  mobile: boolean;
  /** Screenshot scale that keeps the image ≤ 800 px wide. */
  shotScale: number;
}

export const VIEWPORTS: Record<Viewport, ViewportSpec> = {
  desktop: { name: 'desktop', width: 1280, height: 800, dpr: 1, mobile: false, shotScale: 0.625 },
  mobile: { name: 'mobile', width: 390, height: 844, dpr: 2, mobile: true, shotScale: 1 },
};

export const VIEWPORT_NAMES: Viewport[] = ['desktop', 'mobile'];

export interface VerifyIssue {
  check: CheckKind;
  /** Stable machine id, e.g. js_error, horizontal_overflow, absolute_path. */
  rule: string;
  severity: Severity;
  message: string;
  /** file:line:col, a CSS selector, or a URL. */
  where?: string;
  hint?: string;
  /** Where it was seen; absent for source checks. */
  viewports?: Viewport[];
  count?: number;
}

export interface ScreenshotInfo {
  /** API path of the image (editors only); the response adds `url`. */
  path: string;
  width: number;
  height: number;
  full_page: boolean;
}

export interface ViewportMetrics {
  load_ms: number;
  lcp_ms: number | null;
  cls: number | null;
  bytes: number | null;
  requests: number;
}

export interface ViewportReport {
  viewport: Viewport;
  /** The file this view rendered. */
  entrypoint: string;
  width: number;
  height: number;
  dpr: number;
  screenshot: ScreenshotInfo | null;
  metrics: ViewportMetrics | null;
}

export interface DesignReport {
  fonts: Array<{ family: string; share: number }>;
  accents: string[];
  longest_line_chars: number | null;
  title: string;
  missing: string[];
}

export interface VerifyResult {
  id: string;
  artifact_id: string;
  version: number;
  version_id: string;
  live: boolean;
  status: VerifyStatus;
  partial_reason?: 'no_browser' | 'render_failed';
  summary: string;
  counts: Record<Severity, number>;
  issues: VerifyIssue[];
  viewports: ViewportReport[];
  design: DesignReport | null;
  thumbnail_refreshed: boolean;
  duration_ms: number;
  created_at: string;
}

// ── what one browser context reports back (raw, before classification) ──────────

export interface Counted {
  count: number;
}

export interface PageErrorSignal extends Counted {
  message: string;
  where?: string;
}

export interface ConsoleSignal extends Counted {
  level: 'error' | 'warning';
  text: string;
  where?: string;
}

export interface RequestSignal extends Counted {
  url: string;
  method: string;
  type: string;
  status?: number;
  failure?: string;
  /** `code` / `hint` from a ShareOut API (/v1/*) error body. */
  code?: string;
  hint?: string;
  /** A write the read-only render refused — expected, not a defect. */
  readOnlySkip?: boolean;
}

export interface BlockedSignal extends Counted {
  reason: 'csp' | 'navigation' | 'private_network' | 'scheme';
  url: string;
  type: string;
  directive?: string;
}

export interface OverflowOffender {
  selector: string;
  px: number;
}

export interface LayoutSignals {
  viewportWidth: number;
  scrollWidth: number;
  overflow: OverflowOffender[];
  smallTargets: { count: number; examples: Array<{ selector: string; width: number; height: number }> };
  brokenImages: Array<{ selector: string; src: string }>;
  textLength: number;
  visibleMedia: number;
  readyFlag: boolean | null;
}

export interface DesignSignals {
  fonts: Array<{ family: string; share: number }>;
  failedFonts: string[];
  accents: string[];
  longestLine: { selector: string; chars: number } | null;
  title: string;
  hasDescription: boolean;
  hasOgImage: boolean;
  hasFavicon: boolean;
}

export interface AxeViolation {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  help: string;
  helpUrl: string;
  nodes: number;
  targets: string[];
}

export interface PageSignals {
  viewport: Viewport;
  /** The file this view rendered (the phone renders the mobile entrypoint when there is one). */
  entrypoint: string;
  /** A full sentence, set when this view has no results (navigation or HTTP error, or withheld). */
  renderError?: string;
  loadMs: number;
  pageErrors: PageErrorSignal[];
  console: ConsoleSignal[];
  requests: RequestSignal[];
  blocked: BlockedSignal[];
  dialogs: Array<{ type: string; message: string } & Counted>;
  storage: string[];
  popups: number;
  layout: LayoutSignals | null;
  design: DesignSignals | null;
  /** null = not run in this context; { error } = could not run. */
  axe: { violations: AxeViolation[] } | { error: string } | null;
  metrics: { lcpMs: number | null; cls: number | null; bytes: number | null; requests: number };
  screenshot: { bytes: Uint8Array; width: number; height: number; fullPage: boolean } | null;
}
