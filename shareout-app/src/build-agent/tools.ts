/**
 * The build agent's tools. File tools act on the in-memory page and answer with short
 * acknowledgements (never the file back), so the transcript stays small however big the
 * page grows; read_file returns a numbered slice only when the model asks for one.
 */
import type { ProviderTool } from '../crew/provider';
import type { EditError } from '../artifacts/apply-ops';
import { ENTRYPOINT, type FileResult, type PageFiles } from './page-files';

export const TOOL = {
  write: 'write_file',
  append: 'append_file',
  edit: 'edit_file',
  read: 'read_file',
  list: 'list_files',
  del: 'delete_file',
  check: 'check_page',
  publish: 'publish_page',
} as const;

const str = (description: string) => ({ type: 'string', description });

export const BUILD_TOOLS: ProviderTool[] = [
  {
    name: TOOL.write,
    description: `Create a file, or replace it completely. Keep one call under ~5000 tokens: for a bigger file write the first part here and add the rest with ${TOOL.append}. The entry file is ${ENTRYPOINT}; reference siblings with relative paths ("styles.css", "./app.js"), never "/styles.css".`,
    input_schema: { type: 'object', properties: { path: str('Relative path, e.g. index.html, styles.css, app.js'), content: str('The whole text of the file (or its first part)') }, required: ['path', 'content'] },
    eagerInput: true,
  },
  {
    name: TOOL.append,
    description: 'Add text to the END of a file (created if missing). Use it to continue a file that is too long for one call. Continue exactly where the file ends; do not repeat anything.',
    input_schema: { type: 'object', properties: { path: str('Relative path'), content: str('The next part of the file') }, required: ['path', 'content'] },
    eagerInput: true,
  },
  {
    name: TOOL.edit,
    description: 'Change part of a file: `old` must appear exactly once (or set all=true). Copy `old` exactly from the file (use read_file to see it). Prefer this over rewriting a file.',
    input_schema: {
      type: 'object',
      properties: { path: str('Relative path'), old: str('Exact text to replace'), new: str('Replacement text'), all: { type: 'boolean', description: 'Replace every occurrence' } },
      required: ['path', 'old', 'new'],
    },
    eagerInput: true,
  },
  {
    name: TOOL.read,
    description: 'Read lines of a file (numbered; the numbers are not part of the file). At most 150 lines per call; pass start_line/end_line for a section.',
    input_schema: { type: 'object', properties: { path: str('Relative path'), start_line: { type: 'integer' }, end_line: { type: 'integer' } }, required: ['path'] },
  },
  { name: TOOL.list, description: 'List the page files with their sizes.', input_schema: { type: 'object', properties: {} } },
  { name: TOOL.del, description: 'Delete a file.', input_schema: { type: 'object', properties: { path: str('Relative path') }, required: ['path'] } },
  {
    name: TOOL.check,
    description: 'Run the checks on the page as it stands: JavaScript syntax, manifest JSON, files referenced but missing, tables used but not declared, and ShareOut\'s publishing rules. Returns the errors to fix. Run it when you think the page is complete.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: TOOL.publish,
    description: 'Publish the page. It re-runs the checks first and refuses while errors remain. Once published the page is opened and tested the way a visitor sees it; any problems found come back to you to fix with edit_file, then call publish_page again. You are done when this reports success.',
    input_schema: { type: 'object', properties: {} },
  },
];

const MAX_READ_LINES = 150;
const MAX_READ_CHARS = 8000;

export interface ToolReply {
  content: string;
  isError: boolean;
  /** The file the call touched, for progress lines. */
  path?: string;
}

const fail = (e: EditError): ToolReply => ({ isError: true, path: e.path, content: `${e.code}: ${e.message}` });
const done = (r: FileResult, path: string): ToolReply => (r.ok ? { isError: false, path, content: r.note } : fail(r.error));

function needStr(input: Record<string, unknown>, key: string): string | null {
  return typeof input[key] === 'string' ? (input[key] as string) : null;
}

/** Runs one file tool. Returns null for tools that are not file tools. */
export function runFileTool(files: PageFiles, name: string, input: Record<string, unknown>): ToolReply | null {
  switch (name) {
    case TOOL.write:
    case TOOL.append: {
      const path = needStr(input, 'path');
      const content = needStr(input, 'content');
      if (path === null || content === null) return { isError: true, content: `INVALID_INPUT: ${name} needs "path" and "content" as strings.` };
      return done(name === TOOL.write ? files.write(path, content) : files.append(path, content), path);
    }
    case TOOL.edit: {
      const path = needStr(input, 'path');
      const old = needStr(input, 'old');
      const next = needStr(input, 'new');
      if (path === null || !old || next === null) return { isError: true, content: 'INVALID_INPUT: edit_file needs "path", a non-empty "old" and "new" as strings.' };
      return done(files.edit([{ op: 'replace', path, old, new: next, ...(input.all === true ? { all: true } : {}) }]), path);
    }
    case TOOL.del: {
      const path = needStr(input, 'path');
      if (!path) return { isError: true, content: 'INVALID_INPUT: delete_file needs "path".' };
      return done(files.edit([{ op: 'delete', path }]), path);
    }
    case TOOL.read: {
      const path = needStr(input, 'path');
      if (!path) return { isError: true, content: 'INVALID_INPUT: read_file needs "path".' };
      const text = files.text(path);
      if (text === undefined) return { isError: true, path, content: `FILE_NOT_FOUND: there is no file "${path}". Files: ${files.paths().join(', ') || 'none yet'}.` };
      const lines = text.split('\n');
      const start = Math.max(1, Math.floor(Number(input.start_line) || 1));
      const end = Math.min(lines.length, Math.floor(Number(input.end_line) || start + MAX_READ_LINES - 1), start + MAX_READ_LINES - 1);
      let out = '';
      let last = start - 1;
      for (let n = start; n <= end; n++) {
        const row = `${n}\t${lines[n - 1]}\n`;
        if (out.length + row.length > MAX_READ_CHARS) break;
        out += row;
        last = n;
      }
      const more = last < lines.length ? `\n(${path} has ${lines.length} lines; showing ${start}-${last}. Pass start_line to read on.)` : '';
      return { isError: false, path, content: `${out}${more}` };
    }
    case TOOL.list:
      return { isError: false, content: files.entries().map((f) => `${f.path}  ${f.text.length} chars`).join('\n') || 'No files yet.' };
    default:
      return null;
  }
}
