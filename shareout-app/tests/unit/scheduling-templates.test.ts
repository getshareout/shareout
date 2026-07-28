import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  renderTemplate,
  buildTemplateContext,
  validateVariables,
  applyDefaults,
  type TemplateVariablesSchema,
} from '../../src/scheduling/template-renderer';
import {
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  deleteTemplate,
  previewTemplate,
} from '../../src/scheduling/templates';
import type { Env } from '../../src/types';

function createMockDb(firstResults: unknown[] = [], allResults: unknown[] = []) {
  let firstIdx = 0;
  let allIdx = 0;

  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => firstResults[firstIdx++] ?? null),
        all: vi.fn(async () => ({ results: allResults[allIdx++] || [] })),
        run: vi.fn(async () => ({ success: true })),
      })),
    })),
  };
}

function testEnv(firstResults: unknown[] = [], allResults: unknown[] = []): Env {
  return {
    DB: createMockDb(firstResults, allResults),
    SHAREOUT_BASE_URL: 'https://shareout.example.com',
  } as unknown as Env;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('template-renderer', () => {
  describe('renderTemplate', () => {
    it('replaces simple variables', () => {
      const context = buildTemplateContext({
        id: 'art_123',
        name: 'My Dashboard',
        slug: 'my-dashboard',
        url: 'https://shareout.site/a/my-dashboard/',
      });

      const result = renderTemplate(
        '<h1>{{artifact.name}}</h1>',
        'Update from {{artifact.name}}',
        context,
        {}
      );

      expect(result.subject).toBe('Update from My Dashboard');
      expect(result.html).toBe('<h1>My Dashboard</h1>');
      expect(result.warnings).toBeUndefined();
    });

    it('replaces data variables', () => {
      const context = buildTemplateContext({
        id: 'art_123',
        name: 'Report',
        slug: 'report',
        url: 'https://shareout.site/a/report/',
      });

      const result = renderTemplate(
        '<p>Sales: {{data.sales}}</p>',
        'Report for {{date}}',
        context,
        { sales: 1500 }
      );

      expect(result.html).toBe('<p>Sales: 1500</p>');
      expect(result.subject).toMatch(/^Report for \d{4}-\d{2}-\d{2}$/);
    });

    it('handles missing variables with warnings', () => {
      const context = buildTemplateContext({
        id: 'art_123',
        name: 'Test',
        slug: 'test',
        url: 'https://shareout.site/a/test/',
      });

      const result = renderTemplate(
        '<p>{{data.missing}}</p>',
        'Subject',
        context,
        {}
      );

      expect(result.html).toBe('<p></p>');
      expect(result.warnings).toContain('Variable not found: data.missing');
    });

    it('handles nested data paths', () => {
      const context = buildTemplateContext({
        id: 'art_123',
        name: 'Test',
        slug: 'test',
        url: 'https://shareout.site/a/test/',
      });

      const result = renderTemplate(
        '<p>{{data.user.name}} - {{data.user.email}}</p>',
        'Hi {{data.user.name}}',
        context,
        { user: { name: 'John', email: 'john@example.com' } }
      );

      expect(result.html).toBe('<p>John - john@example.com</p>');
      expect(result.subject).toBe('Hi John');
    });
  });

  describe('buildTemplateContext', () => {
    it('builds context with artifact info and dates', () => {
      const context = buildTemplateContext({
        id: 'art_123',
        name: 'Dashboard',
        slug: 'dashboard',
        url: 'https://shareout.site/a/dashboard/',
      });

      expect(context.artifact.id).toBe('art_123');
      expect(context.artifact.name).toBe('Dashboard');
      expect(context.artifact.url).toBe('https://shareout.site/a/dashboard/');
      expect(context.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(context.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof context.timestamp).toBe('number');
    });
  });

  describe('validateVariables', () => {
    it('passes when all required variables are provided', () => {
      const schema: TemplateVariablesSchema = {
        variables: [
          { name: 'name', type: 'string', required: true },
          { name: 'count', type: 'number', required: true },
        ],
      };

      const result = validateVariables(schema, { name: 'Test', count: 5 });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('fails when required variables are missing', () => {
      const schema: TemplateVariablesSchema = {
        variables: [
          { name: 'name', type: 'string', required: true },
          { name: 'email', type: 'string', required: true },
        ],
      };

      const result = validateVariables(schema, { name: 'Test' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Required variable missing: email');
    });

    it('passes when missing variable has default', () => {
      const schema: TemplateVariablesSchema = {
        variables: [
          { name: 'theme', type: 'string', required: true, default: 'light' },
        ],
      };

      const result = validateVariables(schema, {});
      expect(result.valid).toBe(true);
    });
  });

  describe('applyDefaults', () => {
    it('applies default values for missing variables', () => {
      const schema: TemplateVariablesSchema = {
        variables: [
          { name: 'theme', type: 'string', required: false, default: 'light' },
          { name: 'count', type: 'number', required: false, default: 10 },
        ],
      };

      const result = applyDefaults(schema, { theme: 'dark' });
      expect(result).toEqual({ theme: 'dark', count: 10 });
    });

    it('does not override provided values', () => {
      const schema: TemplateVariablesSchema = {
        variables: [
          { name: 'name', type: 'string', required: true, default: 'Default' },
        ],
      };

      const result = applyDefaults(schema, { name: 'Custom' });
      expect(result.name).toBe('Custom');
    });
  });
});

describe('templates CRUD', () => {
  describe('createTemplate', () => {
    it('creates a template with valid data', async () => {
      const env = testEnv([
        null, // SELECT id FROM email_templates (duplicate check)
        {     // SELECT * FROM email_templates WHERE id (after insert)
          id: 'tpl_123',
          artifact_id: null,
          owner_id: 'user_1',
          name: 'Weekly Report',
          subject: 'Weekly Update',
          html: '<h1>Report</h1>',
          text_body: null,
          variables_schema: '{"variables":[]}',
          is_system: 0,
          created_at: 1704067200,
          updated_at: 1704067200,
        },
      ]);

      const result = await createTemplate(env, 'user_1', {
        name: 'Weekly Report',
        subject: 'Weekly Update',
        html: '<h1>Report</h1>',
      });

      expect(result.error).toBeUndefined();
      expect(result.template?.name).toBe('Weekly Report');
      expect(result.template?.subject).toBe('Weekly Update');
    });

    it('rejects empty name', async () => {
      const env = testEnv();

      const result = await createTemplate(env, 'user_1', {
        name: '',
        subject: 'Subject',
        html: '<p>Content</p>',
      });

      expect(result.error).toBe('Template name is required');
    });

    it('rejects duplicate name', async () => {
      const env = testEnv([
        { id: 'tpl_existing' }, // duplicate check returns existing
      ]);

      const result = await createTemplate(env, 'user_1', {
        name: 'Existing Template',
        subject: 'Subject',
        html: '<p>Content</p>',
      });

      expect(result.error).toBe('A template with this name already exists');
    });
  });

  describe('getTemplate', () => {
    it('returns template for owner', async () => {
      const env = testEnv([{
        id: 'tpl_123',
        artifact_id: null,
        owner_id: 'user_1',
        name: 'My Template',
        subject: 'Subject',
        html: '<p>Content</p>',
        text_body: null,
        variables_schema: '{"variables":[]}',
        is_system: 0,
        created_at: 1704067200,
        updated_at: 1704067200,
      }]);

      const result = await getTemplate(env, 'tpl_123', 'user_1');

      expect(result.error).toBeUndefined();
      expect(result.template?.id).toBe('tpl_123');
      expect(result.template?.name).toBe('My Template');
    });

    it('denies access for non-owner', async () => {
      const env = testEnv([{
        id: 'tpl_123',
        artifact_id: null,
        owner_id: 'user_other',
        name: 'Other Template',
        subject: 'Subject',
        html: '<p>Content</p>',
        text_body: null,
        variables_schema: '{"variables":[]}',
        is_system: 0,
        created_at: 1704067200,
        updated_at: 1704067200,
      }]);

      const result = await getTemplate(env, 'tpl_123', 'user_1');

      expect(result.error).toBe('Permission denied');
    });

    it('allows access to system templates', async () => {
      const env = testEnv([{
        id: 'tpl_system',
        artifact_id: null,
        owner_id: 'admin',
        name: 'System Template',
        subject: 'System',
        html: '<p>System</p>',
        text_body: null,
        variables_schema: '{"variables":[]}',
        is_system: 1,
        created_at: 1704067200,
        updated_at: 1704067200,
      }]);

      const result = await getTemplate(env, 'tpl_system', 'user_1');

      expect(result.error).toBeUndefined();
      expect(result.template?.is_system).toBe(true);
    });
  });

  describe('updateTemplate', () => {
    it('updates template properties', async () => {
      const env = testEnv([
        { // First SELECT to check ownership
          id: 'tpl_123',
          artifact_id: null,
          owner_id: 'user_1',
          name: 'Original Name',
          subject: 'Original Subject',
          html: '<p>Content</p>',
          text_body: null,
          variables_schema: '{"variables":[]}',
          is_system: 0,
          created_at: 1704067200,
          updated_at: 1704067200,
        },
        { // Second SELECT after update
          id: 'tpl_123',
          artifact_id: null,
          owner_id: 'user_1',
          name: 'Updated Name',
          subject: 'Updated Subject',
          html: '<p>Content</p>',
          text_body: null,
          variables_schema: '{"variables":[]}',
          is_system: 0,
          created_at: 1704067200,
          updated_at: 1704153600,
        },
      ]);

      const result = await updateTemplate(env, 'user_1', 'tpl_123', {
        name: 'Updated Name',
        subject: 'Updated Subject',
      });

      expect(result.error).toBeUndefined();
      expect(result.template?.name).toBe('Updated Name');
    });

    it('prevents modifying system templates', async () => {
      const env = testEnv([{
        id: 'tpl_system',
        artifact_id: null,
        owner_id: 'user_1',
        name: 'System Template',
        subject: 'System',
        html: '<p>System</p>',
        text_body: null,
        variables_schema: '{"variables":[]}',
        is_system: 1,
        created_at: 1704067200,
        updated_at: 1704067200,
      }]);

      const result = await updateTemplate(env, 'user_1', 'tpl_system', {
        name: 'New Name',
      });

      expect(result.error).toBe('Cannot modify system templates');
    });
  });

  describe('deleteTemplate', () => {
    it('deletes owned template', async () => {
      const env = testEnv([{
        owner_id: 'user_1',
        is_system: 0,
      }]);

      const result = await deleteTemplate(env, 'user_1', 'tpl_123');

      expect(result.success).toBe(true);
    });

    it('prevents deleting system templates', async () => {
      const env = testEnv([{
        owner_id: 'user_1',
        is_system: 1,
      }]);

      const result = await deleteTemplate(env, 'user_1', 'tpl_system');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot delete system templates');
    });
  });

  describe('listTemplates', () => {
    it('lists account-level templates', async () => {
      const env = testEnv([], [[
        {
          id: 'tpl_1',
          artifact_id: null,
          owner_id: 'user_1',
          name: 'Template 1',
          subject: 'Subject 1',
          html: '<p>1</p>',
          text_body: null,
          variables_schema: '{"variables":[]}',
          is_system: 0,
          created_at: 1704067200,
          updated_at: 1704067200,
        },
        {
          id: 'tpl_2',
          artifact_id: null,
          owner_id: 'user_1',
          name: 'Template 2',
          subject: 'Subject 2',
          html: '<p>2</p>',
          text_body: null,
          variables_schema: '{"variables":[]}',
          is_system: 0,
          created_at: 1704153600,
          updated_at: 1704153600,
        },
      ]]);

      const templates = await listTemplates(env, 'user_1', { scope: 'account' });

      expect(templates).toHaveLength(2);
      expect(templates[0].name).toBe('Template 1');
    });
  });

  describe('previewTemplate', () => {
    it('renders template with artifact context', async () => {
      const env = testEnv([
        { // getTemplate query
          id: 'tpl_123',
          artifact_id: null,
          owner_id: 'user_1',
          name: 'Report',
          subject: '{{artifact.name}} - {{date}}',
          html: '<h1>{{artifact.name}}</h1><p>{{data.message}}</p>',
          text_body: null,
          variables_schema: '{"variables":[]}',
          is_system: 0,
          created_at: 1704067200,
          updated_at: 1704067200,
        },
        { // artifact query
          id: 'art_456',
          name: 'My Dashboard',
          slug: 'my-dashboard',
        },
      ]);

      const result = await previewTemplate(env, 'user_1', {
        template_id: 'tpl_123',
        artifact_id: 'art_456',
        data: { message: 'Hello World' },
      });

      expect(result.error).toBeUndefined();
      expect(result.rendered?.html).toBe('<h1>My Dashboard</h1><p>Hello World</p>');
      expect(result.rendered?.subject).toMatch(/^My Dashboard - \d{4}-\d{2}-\d{2}$/);
    });

    it('previews inline template without saving', async () => {
      const env = testEnv([{
        id: 'art_456',
        name: 'Test Artifact',
        slug: 'test',
      }]);

      const result = await previewTemplate(env, 'user_1', {
        inline_html: '<p>{{artifact.url}}</p>',
        inline_subject: 'Preview Test',
        artifact_id: 'art_456',
      });

      expect(result.error).toBeUndefined();
      expect(result.rendered?.html).toContain('shareout.example.com/a/test/');
      expect(result.rendered?.subject).toBe('Preview Test');
    });
  });
});
