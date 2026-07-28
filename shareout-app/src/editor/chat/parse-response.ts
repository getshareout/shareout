/**
 * Normalize raw LLM output into a structured {@link EditorChatResponse}.
 *
 * Supports the current `{ reply, changes }` schema and legacy `{ patches, message }`
 * payloads. Non-JSON replies fall back to plain explanation text.
 */

import type { EditorChatResponse, HtmlPatch } from '../types';
import { debugError, debugLog } from './config';

export function parseAgentResponse(response: string): EditorChatResponse {
  debugLog('PARSE_AGENT', 'Parsing response', {
    responseLength: response.length,
    responsePreview: response.slice(0, 200),
  });

  let jsonStr = response;

  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    debugLog('PARSE_AGENT', 'Found markdown code block, extracting JSON');
    jsonStr = jsonMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    debugLog('PARSE_AGENT', 'JSON parsed successfully', {
      hasReply: 'reply' in parsed,
      hasChanges: 'changes' in parsed,
      hasPatches: 'patches' in parsed,
      hasHtml: 'html' in parsed,
      hasMessage: 'message' in parsed,
    });

    if ('reply' in parsed) {
      const changes = parsed.changes;
      const hasPatches = changes?.patches?.length > 0;
      const hasHtml = !!changes?.html;

      debugLog('PARSE_AGENT', 'New format detected', {
        reply: parsed.reply?.slice(0, 100),
        hasChanges: !!changes,
        hasPatches,
        patchCount: changes?.patches?.length || 0,
        hasHtml,
      });

      if (hasPatches && changes?.patches) {
        changes.patches.forEach((p: HtmlPatch, i: number) => {
          debugLog('PATCH_PARSED', `Patch ${i + 1}:`, {
            selector: p.selector,
            selectorType: typeof p.selector,
            action: p.action,
            contentLength: p.content?.length,
            contentPreview: p.content?.substring(0, 100),
            attribute: p.attribute,
            value: p.value,
          });
        });
      }

      const actions = changes?.actions;
      const hasActions = Array.isArray(actions) && actions.length > 0;

      return {
        type: hasHtml ? 'full_replace' : (hasPatches || hasActions) ? 'html_patch' : 'explanation',
        patches: changes?.patches,
        html: changes?.html,
        actions: hasActions ? actions : undefined,
        message: parsed.reply || 'Done.',
      };
    }

    debugLog('PARSE_AGENT', 'Legacy format detected', {
      hasPatches: !!parsed.patches?.length,
      patchCount: parsed.patches?.length || 0,
      hasHtml: !!parsed.html,
    });

    if (parsed.patches?.length) {
      parsed.patches.forEach((p: HtmlPatch, i: number) => {
        debugLog('PATCH_PARSED', `Legacy Patch ${i + 1}:`, {
          selector: p.selector,
          selectorType: typeof p.selector,
          action: p.action,
          contentLength: p.content?.length,
          contentPreview: p.content?.substring(0, 100),
          attribute: p.attribute,
          value: p.value,
        });
      });
    }

    return {
      type: parsed.html ? 'full_replace' : (parsed.patches?.length || parsed.actions?.length) ? 'html_patch' : 'explanation',
      patches: parsed.patches,
      html: parsed.html,
      actions: parsed.actions?.length ? parsed.actions : undefined,
      message: parsed.message || 'Changes ready to apply.',
    };
  } catch (parseError) {
    debugError('PARSE_AGENT', 'JSON parsing failed, treating as plain text', {
      error: parseError instanceof Error ? parseError.message : String(parseError),
      jsonStrPreview: jsonStr.slice(0, 200),
    });
    return {
      type: 'explanation',
      message: response,
    };
  }
}
