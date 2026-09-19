const LABELS: Record<string, string> = {
  list_artifacts: 'Looking through your pages…',
  search_artifacts: 'Searching your pages…',
  search_workspace: 'Searching the workspace…',
  read_artifact: 'Reading the page…',
  list_data_sources: 'Checking data sources…',
  run_data_source: 'Running the data source…',
  list_connections: 'Checking your connectors…',
  list_files: 'Looking through your files…',
  read_file: 'Reading the file…',
  catalog_search: 'Searching the data catalog…',
  catalog_get: 'Reading the data catalog…',
  knowledge_search: 'Searching the knowledge base…',
  knowledge_get: 'Reading the knowledge base…',
  send_snapshot: 'Taking a snapshot…',
  send_pdf: 'Making the PDF…',
  list_alerts: 'Checking your alerts…',
  list_jobs: 'Checking your jobs…',
  create_artifact: 'Planning your page…',
  edit_page: 'Preparing the edit…',
  present_artifact: 'Preparing the presentation…',
};

/** Instant canvas actions — nothing worth announcing. */
const SILENT = new Set(['show_artifacts', 'open_artifact', 'show_onboarding']);

/** Short progress line shown while a tool runs, or null when the tool is instant. */
export function toolProgressLabel(name: string, input: Record<string, unknown>): string | null {
  if (SILENT.has(name)) return null;
  if (name === 'query_connection') {
    const conn = typeof input.connection === 'string' ? input.connection.trim().slice(0, 60) : '';
    return conn ? `Querying ${conn}…` : 'Querying your data…';
  }
  return LABELS[name] ?? 'Working on it…';
}
