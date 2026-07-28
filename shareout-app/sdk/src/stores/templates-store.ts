import { ShareOutError } from '../shareout-error';
import type { SdkClient } from '../core/sdk-client';

// Email templates types
export interface TemplateVariable {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'json';
  required: boolean;
  default?: unknown;
  description?: string;
}

export interface EmailTemplate {
  id: string;
  artifactId: string | null;
  name: string;
  subject: string;
  html: string;
  textBody: string | null;
  variablesSchema: { variables: TemplateVariable[] };
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateParams {
  name: string;
  subject: string;
  html: string;
  textBody?: string;
  variables?: TemplateVariable[];
  artifactId?: string;
}

export interface UpdateTemplateParams {
  name?: string;
  subject?: string;
  html?: string;
  textBody?: string;
  variables?: TemplateVariable[];
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text?: string;
  warnings?: string[];
}

export class TemplatesStore {
  constructor(private sdk: SdkClient) {}

  async list(scope?: 'account' | 'artifact' | 'all'): Promise<EmailTemplate[]> {
    const params = new URLSearchParams();
    if (scope) params.set('scope', scope);
    const query = params.toString();
    const result = await this.sdk._authFetch<{ templates: EmailTemplate[]; count: number }>(
      `/templates${query ? '?' + query : ''}`
    );
    return result.templates;
  }

  async get(id: string): Promise<EmailTemplate | null> {
    try {
      const result = await this.sdk._authFetch<{ template: EmailTemplate }>(`/templates/${encodeURIComponent(id)}`);
      return result.template;
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'NOT_FOUND') return null;
      throw e;
    }
  }

  async create(params: CreateTemplateParams): Promise<EmailTemplate> {
    const result = await this.sdk._authFetch<{ template: EmailTemplate }>('/templates', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return result.template;
  }

  async update(id: string, params: UpdateTemplateParams): Promise<EmailTemplate | null> {
    try {
      const result = await this.sdk._authFetch<{ template: EmailTemplate }>(
        `/templates/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(params),
        }
      );
      return result.template;
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'NOT_FOUND') return null;
      throw e;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.sdk._authFetch(`/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return true;
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'NOT_FOUND') return false;
      throw e;
    }
  }

  async preview(templateId: string, artifactId: string, data?: Record<string, unknown>): Promise<RenderedEmail> {
    const result = await this.sdk._authFetch<{ rendered: RenderedEmail }>(
      `/templates/${encodeURIComponent(templateId)}/preview`,
      {
        method: 'POST',
        body: JSON.stringify({ artifact_id: artifactId, data: data || {} }),
      }
    );
    return result.rendered;
  }

  async previewInline(
    html: string,
    subject: string,
    artifactId: string,
    data?: Record<string, unknown>
  ): Promise<RenderedEmail> {
    const result = await this.sdk._authFetch<{ rendered: RenderedEmail }>('/templates/preview', {
      method: 'POST',
      body: JSON.stringify({
        inline_html: html,
        inline_subject: subject,
        artifact_id: artifactId,
        data: data || {},
      }),
    });
    return result.rendered;
  }
}
