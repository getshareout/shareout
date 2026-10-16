import { t } from '../i18n';
import { type Locale } from '../i18n/locale';

const LABELS = {
  en: {
    list_artifacts: 'Looking through your pages…',
    search_artifacts: 'Searching your pages…',
    search_workspace: 'Searching the workspace…',
    read_artifact: 'Reading the page…',
    find_passages: 'Finding the section that covers it…',
    list_versions: 'Checking what changed…',
    list_comments: 'Checking the comments…',
    list_data_sources: 'Checking data sources…',
    run_data_source: 'Running the data source…',
    list_connections: 'Checking your connectors…',
    browse_storage: 'Looking in the bucket…',
    list_files: 'Looking through your files…',
    read_file: 'Reading the file…',
    catalog_search: 'Searching the data catalog…',
    catalog_get: 'Reading the data catalog…',
    knowledge_search: 'Searching the knowledge base…',
    knowledge_get: 'Reading the knowledge base…',
    knowledge_entity: 'Looking it up in the knowledge base…',
    knowledge_facts: 'Checking the facts on record…',
    knowledge_status: 'Checking what the workspace has learned…',
    send_snapshot: 'Taking a snapshot…',
    send_pdf: 'Making the PDF…',
    list_alerts: 'Checking your alerts…',
    list_jobs: 'Checking your jobs…',
    create_artifact: 'Planning your page…',
    edit_page: 'Preparing the edit…',
    present_artifact: 'Preparing the presentation…',
  } as Record<string, string>,
  es: {
    list_artifacts: 'Revisando tus artefactos…',
    search_artifacts: 'Buscando en tus artefactos…',
    search_workspace: 'Buscando en el espacio…',
    read_artifact: 'Leyendo el artefacto…',
    find_passages: 'Buscando la sección que lo cubre…',
    list_versions: 'Revisando qué cambió…',
    list_comments: 'Revisando los comentarios…',
    list_data_sources: 'Revisando las fuentes de datos…',
    run_data_source: 'Trayendo los datos…',
    list_connections: 'Revisando tus conectores…',
    browse_storage: 'Revisando el bucket…',
    list_files: 'Revisando tus archivos…',
    read_file: 'Leyendo el archivo…',
    catalog_search: 'Buscando en el catálogo de datos…',
    catalog_get: 'Leyendo el catálogo de datos…',
    knowledge_search: 'Buscando en Conocimiento…',
    knowledge_get: 'Leyendo Conocimiento…',
    knowledge_entity: 'Buscándolo en Conocimiento…',
    knowledge_facts: 'Revisando los datos registrados…',
    knowledge_status: 'Revisando qué aprendió el espacio…',
    send_snapshot: 'Sacando una captura…',
    send_pdf: 'Armando el PDF…',
    list_alerts: 'Revisando tus alertas…',
    list_jobs: 'Revisando tus envíos programados…',
    create_artifact: 'Pensando tu artefacto…',
    edit_page: 'Preparando el cambio…',
    present_artifact: 'Preparando la presentación…',
  } as Record<string, string>,
};

const FALLBACK = {
  en: { querying: (c: string) => `Querying ${c}…`, queryingData: 'Querying your data…', working: 'Working on it…' },
  es: { querying: (c: string) => `Consultando ${c}…`, queryingData: 'Consultando tus datos…', working: 'Estoy en eso…' },
};

/** Instant canvas actions — nothing worth announcing. */
const SILENT = new Set(['show_artifacts', 'open_artifact', 'show_onboarding']);

/** Short progress line shown while a tool runs, or null when the tool is instant. */
export function toolProgressLabel(name: string, input: Record<string, unknown>, locale: Locale = 'en'): string | null {
  if (SILENT.has(name)) return null;
  const f = t(locale, FALLBACK);
  if (name === 'query_connection') {
    const conn = typeof input.connection === 'string' ? input.connection.trim().slice(0, 60) : '';
    return conn ? f.querying(conn) : f.queryingData;
  }
  return t(locale, LABELS)[name] ?? f.working;
}
