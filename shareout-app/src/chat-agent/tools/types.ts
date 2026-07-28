import type { Env } from '../../types';
import type { ChatReplyPort, PlatformId, WorkspaceSelection } from '../../chat-platforms/types';

export interface ToolContext {
  env: Env;
  /** The linked ShareOut user the agent acts as. All access is scoped to this id. */
  userId: string;
  /** Outbound channel — preferred over legacy chatId. */
  reply?: ChatReplyPort;
  platform?: PlatformId;
  /** @deprecated Use reply port. Kept until all callers migrate. */
  chatId?: number;
  /**
   * Optional current chat scope. null/undefined means all accessible pages;
   * "__personal" means personal pages; otherwise it is a workspace id.
   */
  selectedWorkspaceId?: WorkspaceSelection;
}

export interface AccountTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute(ctx: ToolContext, input: Record<string, unknown>): Promise<unknown>;
}
