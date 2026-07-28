import { dispatchAction } from './dispatch';
import { jsonResponse } from './response';
import type { SDKEditorHandler } from './types';

const DEFAULT_AGENT_MODEL = 'claude-sonnet-4-20250514';

const DEFAULT_AGENT_CONFIG = {
  visitor: {
    enabled: false,
    systemPrompt: '',
    model: DEFAULT_AGENT_MODEL,
    maxTokens: 4096,
    temperature: 0.7,
    context: { json: false, tables: [] as string[], blobs: false },
  },
  admin: {
    enabled: true,
    model: DEFAULT_AGENT_MODEL,
  },
};

export const handleAgentEditor: SDKEditorHandler = async (request, ctx, action) => {
  const { artifactId, env } = ctx;

  return dispatchAction(action, {
    get: async () => {
      const config = await env.DB.prepare(`
        SELECT
          visitor_enabled, visitor_system_prompt, visitor_model, visitor_max_tokens, visitor_temperature,
          visitor_context_json, visitor_context_tables, visitor_context_blobs,
          admin_enabled, admin_model
        FROM artifact_agent_config
        WHERE artifact_id = ?
      `).bind(artifactId).first<{
        visitor_enabled: number;
        visitor_system_prompt: string | null;
        visitor_model: string;
        visitor_max_tokens: number;
        visitor_temperature: number;
        visitor_context_json: number;
        visitor_context_tables: string | null;
        visitor_context_blobs: number;
        admin_enabled: number;
        admin_model: string;
      }>();

      return jsonResponse({
        success: true,
        config: config ? {
          visitor: {
            enabled: config.visitor_enabled === 1,
            systemPrompt: config.visitor_system_prompt || '',
            model: config.visitor_model || DEFAULT_AGENT_MODEL,
            maxTokens: config.visitor_max_tokens || 4096,
            temperature: config.visitor_temperature || 0.7,
            context: {
              json: config.visitor_context_json === 1,
              tables: config.visitor_context_tables ? JSON.parse(config.visitor_context_tables) : [],
              blobs: config.visitor_context_blobs === 1,
            },
          },
          admin: {
            enabled: config.admin_enabled === 1,
            model: config.admin_model || DEFAULT_AGENT_MODEL,
          },
        } : DEFAULT_AGENT_CONFIG,
      });
    },

    update: async () => {
      const body = await request.json() as {
        visitor?: {
          enabled?: boolean;
          systemPrompt?: string;
          model?: string;
          maxTokens?: number;
          temperature?: number;
          context?: { json?: boolean; tables?: string[]; blobs?: boolean };
        };
        admin?: {
          enabled?: boolean;
          model?: string;
        };
      };

      await env.DB.prepare(`
        INSERT INTO artifact_agent_config (
          artifact_id,
          visitor_enabled, visitor_system_prompt, visitor_model, visitor_max_tokens, visitor_temperature,
          visitor_context_json, visitor_context_tables, visitor_context_blobs,
          admin_enabled, admin_model
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(artifact_id) DO UPDATE SET
          visitor_enabled = excluded.visitor_enabled,
          visitor_system_prompt = excluded.visitor_system_prompt,
          visitor_model = excluded.visitor_model,
          visitor_max_tokens = excluded.visitor_max_tokens,
          visitor_temperature = excluded.visitor_temperature,
          visitor_context_json = excluded.visitor_context_json,
          visitor_context_tables = excluded.visitor_context_tables,
          visitor_context_blobs = excluded.visitor_context_blobs,
          admin_enabled = excluded.admin_enabled,
          admin_model = excluded.admin_model
      `).bind(
        artifactId,
        body.visitor?.enabled ? 1 : 0,
        body.visitor?.systemPrompt || null,
        body.visitor?.model || DEFAULT_AGENT_MODEL,
        body.visitor?.maxTokens || 4096,
        body.visitor?.temperature || 0.7,
        body.visitor?.context?.json ? 1 : 0,
        body.visitor?.context?.tables ? JSON.stringify(body.visitor.context.tables) : null,
        body.visitor?.context?.blobs ? 1 : 0,
        body.admin?.enabled ? 1 : 0,
        body.admin?.model || DEFAULT_AGENT_MODEL
      ).run();

      return jsonResponse({ success: true });
    },
  });
};
