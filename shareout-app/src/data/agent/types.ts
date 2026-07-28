export type AgentMode = 'visitor' | 'admin' | 'crew' | 'pilot';
export type MessageRole = 'user' | 'assistant' | 'system';
export type EditStatus = 'pending' | 'applied' | 'rejected';

export interface AgentConfig {
  artifact_id: string;
  visitor_enabled: boolean;
  pilot_enabled: boolean;
  visitor_system_prompt: string | null;
  visitor_model: string;
  visitor_max_tokens: number;
  visitor_temperature: number;
  visitor_context_json: boolean;
  visitor_context_tables: string[] | null;
  visitor_context_blobs: boolean;
  admin_enabled: boolean;
  admin_model: string;
  created_at: string;
  updated_at: string;
}

/** An `agent_threads` row as the artifact surfaces see it: scope_key is the artifact. */
export interface Conversation {
  id: string;
  scope_type: 'artifact_visitor' | 'artifact_admin';
  scope_key: string;
  session_id: string | null;
  user_id: string | null;
  title: string | null;
  message_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  thread_id: string;
  role: MessageRole;
  content: string;
  suggested_edits: string | null;
  applied_at: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  model: string | null;
  created_at: string;
}

export interface PendingEdit {
  id: string;
  artifact_id: string;
  thread_id: string;
  file_path: string;
  original_content: string | null;
  new_content: string | null;
  status: EditStatus;
  created_at: string;
}

export interface Usage {
  id: string;
  artifact_id: string;
  mode: AgentMode;
  period: string;
  input_tokens: number;
  output_tokens: number;
  request_count: number;
  error_count: number;
  updated_at: string;
}

export interface ChatRequest {
  message: string;
  conversationId?: string;
  context?: Record<string, unknown>;
}

export interface ChatChunk {
  type: 'content' | 'done' | 'error';
  content?: string;
  usage?: { input_tokens: number; output_tokens: number };
  error?: string;
}

export interface AdminChatRequest extends ChatRequest {
  includeSkillDocs?: boolean;
}

export interface EditSuggestion {
  file: string;
  type: 'replace' | 'insert' | 'delete';
  search?: string;
  replace?: string;
  position?: number;
  content?: string;
}

export interface ApplyEditsRequest {
  conversationId: string;
  edits: EditSuggestion[];
}

export interface AdminContext {
  files: Array<{ path: string; content: string; mime: string }>;
  skillDocs: string;
  artifact: {
    id: string;
    name: string;
    visibility: string;
    currentVersion: number;
  };
  json: Record<string, unknown>;
  tables: string[];
  /** The README of the folder this artifact lives in ("folder guide"), if any —
   *  conventions the editing agent should follow for artifacts in this folder. */
  folderGuide: string | null;
}

export interface VisitorContext {
  json: Record<string, unknown>;
  tables: Record<string, unknown[]>;
  blobUrls: string[];
}
