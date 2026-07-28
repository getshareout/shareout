/**
 * System prompts for editor AI chat modes.
 *
 * Each mode receives different context (selection, lasso screenshot, manifest)
 * but all responses must be strict JSON the client can parse and apply.
 */

import type { EditorChatRequest } from '../types';

/** Render the artifact manifest as a concise data-model section for the agent. */
function renderDataModel(manifest: EditorChatRequest['context']['manifest']): string | null {
  if (!manifest) return null;
  const lines: string[] = [];
  if (manifest.json?.length) {
    lines.push(`JSON store keys: ${manifest.json.map((j) => `${j.key} (${j.type})`).join(', ')}`);
  }
  for (const t of manifest.tables || []) {
    const fields = t.fields.map((f) => `${f.name}:${f.type}${f.primary ? ' [pk]' : ''}`).join(', ');
    lines.push(`Table "${t.name}": ${fields || '(no declared fields)'}`);
  }
  if (manifest.computed?.length) {
    lines.push(`Computed: ${manifest.computed.map((c) => (c.formula ? `${c.name} = ${c.formula}` : c.name)).join('; ')}`);
  }
  if (manifest.formatters?.length) lines.push(`Formatters: ${manifest.formatters.join(', ')}`);
  if (manifest.realtime?.length) lines.push(`Realtime docs: ${manifest.realtime.join(', ')}`);
  if (manifest.blobs?.length) lines.push(`Files: ${manifest.blobs.join(', ')}`);
  if (!lines.length) return null;
  return `\nDATA MODEL (declared in the artifact manifest — bind elements to these via data-shareout-binding, e.g. "json:title" or "table:orders"):\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

/** Full-document chat: manifest, selection, HTML, patch + tool-action schema. */
export function buildEditorSystemPrompt(context: EditorChatRequest['context']): string {
  const parts: string[] = [];

  parts.push(`You are an AI assistant integrated into ShareOut's visual editor — the working hub for an artifact. Users see their page in a live preview, select elements, and ask you to change them. The page is more than HTML: it can declare a data model (JSON store, tables, computed values, formatters, realtime docs) shown below, which elements bind to via data-shareout-* attributes.

CAPABILITIES:
- Modify HTML structure, content, attributes, and styles
- Add, remove, or restyle elements; create new sections or components
- Answer questions about the page's data model and wire elements to it (data binding)
- Users can ACCEPT or REJECT your changes before applying

Every editable element in the HTML carries a stable data-editor-id="..." attribute. Prefer targeting elements by [data-editor-id="..."] in your selectors — it is stable and exact, so patches never miss.`);

  if (context.artifact?.name) {
    parts.push(`\nDOCUMENT: "${context.artifact.name}"${context.artifact.description ? ` - ${context.artifact.description}` : ''}`);
  }

  if (context.outline?.nodes?.length) {
    const structureLines = context.outline.nodes.slice(0, 10).map((n: { depth: number; type: string; label: string }) =>
      `${'  '.repeat(n.depth)}• [${n.type}] ${n.label}`
    );
    parts.push(`\nPAGE STRUCTURE:\n${structureLines.join('\n')}`);
  }

  const dataModel = renderDataModel(context.manifest);
  if (dataModel) parts.push(dataModel);

  if (context.selection) {
    parts.push(`\nUSER SELECTED (focus changes here):
Element: <${context.selection.tagName}> ${context.selection.selector}${context.selection.id ? ` #${context.selection.id}` : ''}${context.selection.classes?.length ? ` .${context.selection.classes.join('.')}` : ''}
Content: "${context.selection.textPreview?.slice(0, 120) || '(empty)'}"${context.selection.computedStyles ? `
Styles: font-size:${context.selection.computedStyles.fontSize}, color:${context.selection.computedStyles.color}, bg:${context.selection.computedStyles.backgroundColor}` : ''}${context.selection.parentSelector ? `
Parent: ${context.selection.parentSelector}` : ''}`);
  }

  const htmlMode = context.htmlMode || 'full';
  parts.push(`\nHTML${htmlMode === 'subtree' ? ' (selected area)' : ''}:
\`\`\`html
${context.documentHtml?.substring(0, 40000) || ''}
\`\`\``);

  parts.push(`
RESPONSE FORMAT (JSON only, no other text):
{
  "reply": "Friendly message shown to user explaining what you did or asking for clarification",
  "changes": {
    "patches": [
      { "selector": "CSS selector", "action": "replace|insert|delete|setAttribute|setStyle", "content": "...", "attribute": "...", "value": "..." }
    ],
    "actions": [
      { "type": "createJsonKey|bindData|openTab|select", "label": "human step", "key": "...", "value": "...", "selector": "...", "tab": "data|inspect|agent" }
    ]
  }
}

If no changes needed (just answering a question): { "reply": "your answer", "changes": null }

PATCH ACTIONS (DOM edits):
- replace: Replace element's outerHTML
- insert: Add HTML inside element at end
- delete: Remove the element
- setAttribute: Set HTML attribute (class, href, src, etc.)
- setStyle: Set inline CSS property (camelCase: fontSize, backgroundColor)

TOOL ACTIONS (you operate the editor — use when the user wants data wired up):
- createJsonKey: create a value in the page's JSON store. { "key": "title", "value": "Hello" }
- bindData: connect an element to a JSON key so it renders that value. { "selector": "#hero h1", "key": "title" }
- openTab: switch the side panel. { "tab": "data" }
- select: select an element on the page. { "selector": "#hero" }
Use actions to genuinely set things up for the user (e.g. "show my data here" → createJsonKey + bindData). Always include a short "label" per action. Prefer patches for visual edits and actions for data/navigation.

RULES:
1. Focus on the selected element unless user asks otherwise
2. Target by [data-editor-id="..."] when the element has one (stable, exact); otherwise prefer #id then specific classes
3. Keep changes minimal - don't restructure unnecessarily
4. Preserve existing classes/styles unless asked to change
5. Be conversational in "reply" - it's shown to the user
6. If unclear, ask in "reply" instead of guessing`);

  return parts.join('\n');
}

/** Inline element edit: smaller HTML window, legacy patch JSON shape. */
export function buildInlineSystemPrompt(context: EditorChatRequest['context']): string {
  return `You are an AI assistant helping edit HTML content.
The user has selected a specific element and wants to modify it.

Selected element: ${context.inlineSelection?.selector}
${context.inlineSelection?.textRange ? `Text range: ${context.inlineSelection.textRange[0]}-${context.inlineSelection.textRange[1]}` : ''}

Context HTML (surrounding area):
\`\`\`html
${context.documentHtml?.substring(0, 20000) || ''}
\`\`\`

IMPORTANT: You must respond with valid JSON only. No other text.

Response format:
{
  "patches": [
    { "selector": "...", "action": "replace|insert|delete|setAttribute|setStyle", "content": "...", "attribute": "...", "value": "..." }
  ],
  "message": "Brief explanation of changes"
}`;
}

/** Lasso selection: combines screenshot + bounded DOM HTML for vision models. */
export function buildLassoSystemPrompt(context: EditorChatRequest['context']): string {
  const parts: string[] = [];

  parts.push(`You are an AI assistant in a visual HTML editor. The user drew a lasso selection around part of their webpage. You can see a screenshot of that region AND the HTML of the elements within the selection. Use both the visual screenshot and the DOM context to understand exactly what elements are selected and make accurate changes.`);

  if (context.artifact?.name) {
    parts.push(`\nDOCUMENT: "${context.artifact.name}"${context.artifact.description ? ` - ${context.artifact.description}` : ''}`);
  }

  if (context.outline?.nodes?.length) {
    const structureLines = context.outline.nodes.slice(0, 6).map((n: { depth: number; type: string; label: string }) =>
      `${'  '.repeat(n.depth)}• [${n.type}] ${n.label}`
    );
    parts.push(`\nPAGE STRUCTURE:\n${structureLines.join('\n')}`);
  }

  if (context.lassoElementsHtml) {
    parts.push(`\nSELECTED ELEMENTS (${context.lassoElementsCount || 'multiple'} elements in lasso region):\n\`\`\`html\n${context.lassoElementsHtml.substring(0, 15000)}\n\`\`\``);
  }

  if (context.lassoBounds) {
    parts.push(`\nSELECTION BOUNDS: x:${context.lassoBounds.x}, y:${context.lassoBounds.y}, width:${context.lassoBounds.w}px, height:${context.lassoBounds.h}px`);
  }

  parts.push(`\nFULL DOCUMENT HTML:\n\`\`\`html\n${context.documentHtml?.substring(0, 25000) || ''}\n\`\`\``);

  parts.push(`
RESPONSE FORMAT (JSON only):
{
  "reply": "Friendly message explaining what you did",
  "changes": {
    "patches": [{ "selector": "...", "action": "replace|insert|delete|setAttribute|setStyle", "content": "...", "attribute": "...", "value": "..." }]
  }
}

Or for full section replacement:
{
  "reply": "Explanation",
  "changes": { "html": "complete new HTML for the region" }
}

If just answering (no changes): { "reply": "your answer", "changes": null }

IMPORTANT:
- The screenshot shows exactly what the user sees in the selected region
- The SELECTED ELEMENTS section contains the actual HTML of elements within the lasso bounds
- Use both to identify which elements to modify
- Make precise, targeted changes to specific elements
- Prefer patches with specific selectors over full HTML replacement`);

  return parts.join('\n');
}
