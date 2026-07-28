// ShareOut Visual Editor - Type Definitions

// ============================================================================
// Component Detection
// ============================================================================

export type SDKComponentType =
  | 'json'
  | 'table'
  | 'blobs'
  | 'comments'
  | 'realtime'
  | 'sheets'
  | 'github'
  | 'collaborators'
  | 'agent'
  | 'slides'
  | 'binding';

export type ChartLibrary =
  | 'chartjs'
  | 'echarts'
  | 'recharts'
  | 'plotly'
  | 'd3'
  | 'apexcharts';

// Detected component instances (from HTML scanning)
export interface DetectedComponent {
  type: SDKComponentType;
  selector: string;
  name?: string;
  config?: Record<string, unknown>;
}

export interface DetectedChart {
  library: ChartLibrary;
  selector: string;
  chartType?: string;
  config?: Record<string, unknown>;
}

// ============================================================================
// AI Chat System
// ============================================================================

export type ChatMode = 'normal' | 'inline' | 'lasso' | 'apply' | 'reject';

export interface EditorChatRequest {
  mode: ChatMode;
  prompt: string;
  context: {
    documentHtml: string;
    selectedElements?: string[];
    inlineSelection?: {
      selector: string;
      textRange?: [number, number];
    };
    lassoImage?: string;
    lassoSelector?: string;
    lassoElementsHtml?: string;
    lassoElementsCount?: number;
    lassoBounds?: { x: number; y: number; w: number; h: number };
    artifact?: ArtifactMetadata;
    outline?: OutlineSummary;
    selection?: SelectionContext;
    htmlMode?: 'full' | 'subtree' | 'section';
    /** Compact summary of the artifact's declared data model (from the manifest). */
    manifest?: ManifestContextSummary;
  };
}

/** What the page can bind to — summarized from the artifact manifest for the agent. */
export interface ManifestContextSummary {
  json?: Array<{ key: string; type: string }>;
  tables?: Array<{ name: string; fields: Array<{ name: string; type: string; primary?: boolean }> }>;
  computed?: Array<{ name: string; formula?: string }>;
  formatters?: string[];
  realtime?: string[];
  blobs?: string[];
}

// Enhanced AI Context Types
export interface ArtifactMetadata {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

export interface OutlineSummary {
  nodes: OutlineNodeSummary[];
  totalPages: number;
  totalSections: number;
}

export interface OutlineNodeSummary {
  id: string;
  label: string;
  type: 'page' | 'section' | 'tab' | 'heading';
  selector: string;
  depth: number;
}

export interface SelectionContext {
  selector: string;
  tagName: string;
  id?: string;
  classes: string[];
  textPreview: string;
  parentSelector?: string;
  siblingCount: number;
  computedStyles?: SelectionComputedStyles;
}

export interface SelectionComputedStyles {
  fontSize: string;
  color: string;
  backgroundColor: string;
  padding: string;
  margin: string;
  display: string;
}

export interface EditorChatResponse {
  type: 'html_patch' | 'full_replace' | 'explanation';
  patches?: HtmlPatch[];
  html?: string;
  message?: string;
  /** Tool actions the agent drives beyond DOM edits (bind data, create keys, navigate). */
  actions?: AgentAction[];
}

export interface AgentAction {
  type: 'bindData' | 'createJsonKey' | 'openTab' | 'select';
  /** Human-readable step shown in the plan, e.g. "Bind the heading to title". */
  label?: string;
  selector?: string;
  key?: string;
  value?: unknown;
  tab?: 'agent' | 'inspect' | 'data';
}

export interface HtmlPatch {
  selector: string;
  action: 'replace' | 'insert' | 'delete' | 'setAttribute' | 'setStyle';
  content?: string;
  attribute?: string;
  value?: string;
}

