import type { ProviderTool } from '../../crew/provider';

/**
 * Tool tree: the model starts with a few core tools (find/read pages, canvas) and
 * opens a toolkit to unlock the rest, so each step chooses among a handful of
 * tools instead of ~37. A tool not listed in any toolkit is core.
 */
export const TOOLKITS: Record<string, { summary: string; tools: string[] }> = {
  pages: {
    summary: 'change, build, present, share or export (image/PDF) a page',
    tools: ['search_artifacts', 'edit_page', 'create_artifact', 'present_artifact', 'share_artifact', 'send_snapshot', 'send_pdf'],
  },
  data: {
    summary: 'fresh numbers: run a page’s data sources, SQL on connectors, write table rows / JSON values, watch a metric',
    tools: ['list_data_sources', 'run_data_source', 'list_connections', 'query_connection', 'add_table_row', 'update_table_row', 'set_json_value', 'watch_metric'],
  },
  automations: {
    summary: 'alerts, scheduled jobs and sends, and asking a page’s crew to do work',
    tools: ['list_alerts', 'manage_alert', 'list_jobs', 'manage_job', 'create_schedule', 'ask_crew'],
  },
  knowledge: {
    summary: 'data catalog, workspace knowledge, uploaded files, client notes',
    tools: ['catalog_search', 'catalog_get', 'knowledge_search', 'knowledge_get', 'list_files', 'read_file', 'set_client_notes'],
  },
  skills: {
    summary: 'read and save skills (reusable instructions) in the Library',
    tools: ['list_skills', 'read_skill', 'save_skill'],
  },
};

export const OPEN_TOOLKIT = 'open_toolkit';

export function toolkitOf(toolName: string): string | undefined {
  return Object.keys(TOOLKITS).find((k) => TOOLKITS[k].tools.includes(toolName));
}

/** The open_toolkit tool, describing only toolkits that still have tools to unlock. */
export function openToolkitTool(closed: string[], available: Set<string>): ProviderTool {
  const lines = closed.map((k) => {
    const names = TOOLKITS[k].tools.filter((t) => available.has(t)).join(', ');
    return `- ${k}: ${TOOLKITS[k].summary} (${names})`;
  });
  return {
    name: OPEN_TOOLKIT,
    description: `Unlock more tools for this turn. Open every toolkit the request needs in one call.\n${lines.join('\n')}`,
    input_schema: {
      type: 'object',
      properties: { toolkits: { type: 'array', items: { type: 'string', enum: closed } } },
      required: ['toolkits'],
    },
  };
}
