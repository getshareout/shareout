// Context builder for AI chat - gathers rich context about selection and document
import type { EditorContext } from '../editor/context';
import { detectOutline, type OutlineNode } from '../outline/outline-detector';
import { getElementSelector } from '../dom/element-selector';
import { buildManifestSummary, type ManifestSummary } from '../manifest/manifest-parser';

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

export interface HtmlContext {
  html: string;
  mode: 'full' | 'subtree' | 'section';
  truncated: boolean;
  originalSize: number;
}

export interface EnrichedChatContext {
  artifact: ArtifactMetadata;
  outline: OutlineSummary;
  selection: SelectionContext | null;
  html: string;
  htmlMode: 'full' | 'subtree' | 'section';
  manifest: ManifestSummary | null;
}

const MAX_SUBTREE_SIZE = 15000;
const MAX_FULL_SIZE = 40000;

export function buildEnrichedContext(ctx: EditorContext): EnrichedChatContext {
  const doc = ctx.dom.canvasFrame.contentDocument;
  const selectedElement = ctx.state.selectedElement;

  const artifact = getArtifactMetadata(ctx);
  const outline = doc ? getOutlineSummary(doc) : { nodes: [], totalPages: 0, totalSections: 0 };
  const selection = selectedElement && doc ? getSelectionContext(selectedElement, doc) : null;
  const htmlResult = extractTargetedHtml(ctx, selection);

  return {
    artifact,
    outline,
    selection,
    html: htmlResult.html,
    htmlMode: htmlResult.mode,
    manifest: buildManifestSummary(ctx.state.manifest),
  };
}

export function getArtifactMetadata(ctx: EditorContext): ArtifactMetadata {
  const config = window.EDITOR_CONFIG || ctx.config;
  return {
    id: config.artifactId || '',
    name: (config as { name?: string }).name || '',
    slug: config.slug || '',
    description: (config as { description?: string }).description,
  };
}

export function getOutlineSummary(doc: Document): OutlineSummary {
  const result = detectOutline(doc);

  let totalPages = 0;
  let totalSections = 0;

  const flattenNodes = (nodes: OutlineNode[]): OutlineNodeSummary[] => {
    const summaries: OutlineNodeSummary[] = [];
    for (const node of nodes) {
      if (node.type === 'page') totalPages++;
      if (node.type === 'section') totalSections++;

      summaries.push({
        id: node.id,
        label: node.label,
        type: node.type,
        selector: getElementSelector(node.element),
        depth: node.depth,
      });

      if (node.children.length > 0) {
        summaries.push(...flattenNodes(node.children));
      }
    }
    return summaries;
  };

  return {
    nodes: flattenNodes(result.nodes).slice(0, 20),
    totalPages,
    totalSections,
  };
}

export function getSelectionContext(element: Element, doc: Document): SelectionContext {
  const selector = getElementSelector(element);
  const tagName = element.tagName.toLowerCase();
  const id = element.id || undefined;
  const classes = Array.from(element.classList);
  const textContent = element.textContent?.trim() || '';
  const textPreview = textContent.slice(0, 200);

  const parent = element.parentElement;
  const parentSelector = parent && parent !== doc.body ? getElementSelector(parent) : undefined;
  const siblingCount = parent ? parent.children.length - 1 : 0;

  let computedStyles: SelectionComputedStyles | undefined;
  try {
    const win = doc.defaultView;
    if (win) {
      const styles = win.getComputedStyle(element);
      computedStyles = {
        fontSize: styles.fontSize,
        color: styles.color,
        backgroundColor: styles.backgroundColor,
        padding: styles.padding,
        margin: styles.margin,
        display: styles.display,
      };
    }
  } catch {
    // Ignore style access errors
  }

  return {
    selector,
    tagName,
    id,
    classes,
    textPreview,
    parentSelector,
    siblingCount,
    computedStyles,
  };
}

export function extractTargetedHtml(
  ctx: EditorContext,
  selection: SelectionContext | null
): HtmlContext {
  const fullHtml = ctx.state.html;
  const originalSize = fullHtml.length;

  if (!selection) {
    return {
      html: fullHtml.slice(0, MAX_FULL_SIZE),
      mode: 'full',
      truncated: fullHtml.length > MAX_FULL_SIZE,
      originalSize,
    };
  }

  const doc = ctx.dom.canvasFrame.contentDocument;
  if (!doc) {
    return {
      html: fullHtml.slice(0, MAX_FULL_SIZE),
      mode: 'full',
      truncated: fullHtml.length > MAX_FULL_SIZE,
      originalSize,
    };
  }

  const element = doc.querySelector(selection.selector);
  if (!element) {
    return {
      html: fullHtml.slice(0, MAX_FULL_SIZE),
      mode: 'full',
      truncated: fullHtml.length > MAX_FULL_SIZE,
      originalSize,
    };
  }

  const subtreeHtml = extractSubtreeWithContext(element, doc);
  if (subtreeHtml.length <= MAX_SUBTREE_SIZE) {
    return {
      html: subtreeHtml,
      mode: 'subtree',
      truncated: false,
      originalSize: subtreeHtml.length,
    };
  }

  return {
    html: fullHtml.slice(0, MAX_FULL_SIZE),
    mode: 'full',
    truncated: fullHtml.length > MAX_FULL_SIZE,
    originalSize,
  };
}

function extractSubtreeWithContext(element: Element, doc: Document): string {
  let target = element;
  let depth = 0;

  while (target.parentElement && target.parentElement !== doc.body && depth < 3) {
    target = target.parentElement;
    depth++;
  }

  const clone = target.cloneNode(true) as Element;
  removeEditorAttributes(clone);

  const wrapper = doc.createElement('div');
  wrapper.appendChild(clone);
  return wrapper.innerHTML;
}

function removeEditorAttributes(el: Element): void {
  el.removeAttribute('data-editor-selected');
  el.removeAttribute('data-editor-hover');
  const children = el.querySelectorAll('[data-editor-selected], [data-editor-hover]');
  children.forEach((child) => {
    child.removeAttribute('data-editor-selected');
    child.removeAttribute('data-editor-hover');
  });
}
