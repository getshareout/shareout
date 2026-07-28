/**
 * ShareOut Outline Detector v2.0
 *
 * Detects pages, sections, and tabs using the standardized ShareOut attributes:
 * - data-shareout-page / data-shareout-page-title
 * - data-shareout-section / data-shareout-section-title
 * - data-shareout-tabs / data-shareout-tab / data-shareout-tab-title
 *
 * This replaces the previous 6-strategy heuristic approach with deterministic detection.
 */

import {
  PAGE_ATTR,
  PAGE_TITLE_ATTR,
  SECTION_ATTR,
  SECTION_TITLE_ATTR,
  TABS_ATTR,
  TAB_ATTR,
  TAB_TITLE_ATTR,
} from '../sdk-patterns';

export interface OutlineNode {
  id: string;
  label: string;
  type: 'page' | 'section' | 'tab';
  element: Element;
  children: OutlineNode[];
  depth: number;
}

export interface OutlineResult {
  nodes: OutlineNode[];
  hasManifest: boolean;
  /** Detection strategies that contributed, when tracked. */
  strategies?: string[];
}

/**
 * Detect outline structure from ShareOut attributes
 */
export function detectOutline(doc: Document): OutlineResult {
  const nodes: OutlineNode[] = [];

  // Find all pages
  const pages = doc.querySelectorAll(`[${PAGE_ATTR}]`);

  pages.forEach((pageEl) => {
    const pageId = pageEl.getAttribute(PAGE_ATTR) || pageEl.id || `page-${nodes.length}`;
    const pageTitle = pageEl.getAttribute(PAGE_TITLE_ATTR) || formatLabel(pageId);

    const pageNode: OutlineNode = {
      id: pageId,
      label: pageTitle,
      type: 'page',
      element: pageEl,
      children: [],
      depth: 0,
    };

    // Find sections within this page
    const sections = pageEl.querySelectorAll(`[${SECTION_ATTR}]`);
    sections.forEach((sectionEl) => {
      // Skip if section is inside a nested page
      if (sectionEl.closest(`[${PAGE_ATTR}]`) !== pageEl) return;

      const sectionId = sectionEl.getAttribute(SECTION_ATTR) || sectionEl.id || `section-${pageNode.children.length}`;
      const sectionTitle = sectionEl.getAttribute(SECTION_TITLE_ATTR) || formatLabel(sectionId);

      const sectionNode: OutlineNode = {
        id: sectionId,
        label: sectionTitle,
        type: 'section',
        element: sectionEl,
        children: [],
        depth: 1,
      };

      // Find tabs within this section
      const tabContainers = sectionEl.querySelectorAll(`[${TABS_ATTR}]`);
      tabContainers.forEach((tabContainer) => {
        // Skip if tab container is inside a nested section
        if (tabContainer.closest(`[${SECTION_ATTR}]`) !== sectionEl) return;

        const tabs = tabContainer.querySelectorAll(`[${TAB_ATTR}]`);
        tabs.forEach((tabEl) => {
          const tabId = tabEl.getAttribute(TAB_ATTR) || tabEl.id || `tab-${sectionNode.children.length}`;
          const tabTitle = tabEl.getAttribute(TAB_TITLE_ATTR) || formatLabel(tabId);

          sectionNode.children.push({
            id: tabId,
            label: tabTitle,
            type: 'tab',
            element: tabEl,
            children: [],
            depth: 2,
          });
        });
      });

      pageNode.children.push(sectionNode);
    });

    // Find tabs directly in page (not inside sections)
    const directTabContainers = pageEl.querySelectorAll(`[${TABS_ATTR}]`);
    directTabContainers.forEach((tabContainer) => {
      // Skip if inside a section
      if (tabContainer.closest(`[${SECTION_ATTR}]`)) return;
      // Skip if inside a nested page
      if (tabContainer.closest(`[${PAGE_ATTR}]`) !== pageEl) return;

      const tabs = tabContainer.querySelectorAll(`[${TAB_ATTR}]`);
      tabs.forEach((tabEl) => {
        const tabId = tabEl.getAttribute(TAB_ATTR) || tabEl.id || `tab-${pageNode.children.length}`;
        const tabTitle = tabEl.getAttribute(TAB_TITLE_ATTR) || formatLabel(tabId);

        pageNode.children.push({
          id: tabId,
          label: tabTitle,
          type: 'tab',
          element: tabEl,
          children: [],
          depth: 1,
        });
      });
    });

    nodes.push(pageNode);
  });

  // Find standalone sections (not inside a page)
  const standaloneSections = doc.querySelectorAll(`[${SECTION_ATTR}]`);
  standaloneSections.forEach((sectionEl) => {
    // Skip if inside a page
    if (sectionEl.closest(`[${PAGE_ATTR}]`)) return;

    const sectionId = sectionEl.getAttribute(SECTION_ATTR) || sectionEl.id || `section-${nodes.length}`;
    const sectionTitle = sectionEl.getAttribute(SECTION_TITLE_ATTR) || formatLabel(sectionId);

    const sectionNode: OutlineNode = {
      id: sectionId,
      label: sectionTitle,
      type: 'section',
      element: sectionEl,
      children: [],
      depth: 0,
    };

    // Find tabs within this section
    const tabContainers = sectionEl.querySelectorAll(`[${TABS_ATTR}]`);
    tabContainers.forEach((tabContainer) => {
      const tabs = tabContainer.querySelectorAll(`[${TAB_ATTR}]`);
      tabs.forEach((tabEl) => {
        const tabId = tabEl.getAttribute(TAB_ATTR) || tabEl.id || `tab-${sectionNode.children.length}`;
        const tabTitle = tabEl.getAttribute(TAB_TITLE_ATTR) || formatLabel(tabId);

        sectionNode.children.push({
          id: tabId,
          label: tabTitle,
          type: 'tab',
          element: tabEl,
          children: [],
          depth: 1,
        });
      });
    });

    nodes.push(sectionNode);
  });

  // Find standalone tabs (not inside a page or section)
  const standaloneTabs = doc.querySelectorAll(`[${TABS_ATTR}]`);
  standaloneTabs.forEach((tabContainer) => {
    // Skip if inside a page or section
    if (tabContainer.closest(`[${PAGE_ATTR}]`)) return;
    if (tabContainer.closest(`[${SECTION_ATTR}]`)) return;

    const tabs = tabContainer.querySelectorAll(`[${TAB_ATTR}]`);
    tabs.forEach((tabEl) => {
      const tabId = tabEl.getAttribute(TAB_ATTR) || tabEl.id || `tab-${nodes.length}`;
      const tabTitle = tabEl.getAttribute(TAB_TITLE_ATTR) || formatLabel(tabId);

      nodes.push({
        id: tabId,
        label: tabTitle,
        type: 'tab',
        element: tabEl,
        children: [],
        depth: 0,
      });
    });
  });

  return {
    nodes,
    hasManifest: !!doc.querySelector('script[type="shareout/manifest"]'),
  };
}

/**
 * Format a label from an ID string
 */
function formatLabel(raw: string): string {
  return raw
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
    .slice(0, 40);
}

/**
 * Find outline node by element
 */
export function findNodeByElement(nodes: OutlineNode[], element: Element): OutlineNode | null {
  for (const node of nodes) {
    if (node.element === element) return node;
    const found = findNodeByElement(node.children, element);
    if (found) return found;
  }
  return null;
}

/**
 * Find outline node by ID
 */
export function findNodeById(nodes: OutlineNode[], id: string): OutlineNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return null;
}

/**
 * Get flat list of all nodes
 */
export function flattenOutline(nodes: OutlineNode[]): OutlineNode[] {
  const result: OutlineNode[] = [];
  for (const node of nodes) {
    result.push(node);
    result.push(...flattenOutline(node.children));
  }
  return result;
}

/**
 * Count total nodes including children
 */
export function countNodes(nodes: OutlineNode[]): number {
  let count = nodes.length;
  for (const node of nodes) {
    count += countNodes(node.children);
  }
  return count;
}
