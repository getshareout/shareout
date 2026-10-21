// PDF → editable Markdown page on import: text layer via toMarkdown, scans via a vision
// model, and a PDF artifact when neither yields text.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const transcribePdf = vi.fn();
vi.mock('../../../src/data/files/transcribe-pdf', () => ({ transcribePdf: (...a: unknown[]) => transcribePdf(...a) }));

const { convertPdfImport, pdfMarkdownBody } = await import('../../../src/pages/home/import-office');

const BYTES = new TextEncoder().encode('%PDF-1.4 x');
const PROSE = 'El presente procedimiento establece la metodología para la gestión de residuos generados en obra, incluyendo su clasificación, almacenamiento temporal, transporte y disposición final conforme a la normativa vigente. '.repeat(2);
const TO_MD = (body: string) => `# PA-02.pdf\n## Metadata\n- PDFFormatVersion=1.4\n- IsLinearized=false\n## Contents\n### Page 1\n${body}\n### Page 2\nFin.`;
const envWith = (data: string | null) => ({ AI: { toMarkdown: async () => (data === null ? { format: 'error' } : { format: 'markdown', data }) } }) as unknown as Env;

beforeEach(() => { transcribePdf.mockReset().mockResolvedValue(null); });

describe('pdfMarkdownBody', () => {
  it('drops the file heading, the metadata block and page markers', () => {
    expect(pdfMarkdownBody(TO_MD('Hola mundo.'))).toBe('Hola mundo.\n\nFin.');
  });
});

describe('convertPdfImport', () => {
  it('turns a PDF with text into an editable Markdown page and keeps the original', async () => {
    const out = await convertPdfImport(envWith(TO_MD(PROSE)), 'PA-02 Residuos.pdf', BYTES);
    expect(out.type).toBe('markdown');
    expect(out.entrypoint).toBe('PA-02 Residuos.md');
    expect(out.files[0].content).toContain('gestión de residuos');
    expect(out.files[0].content).not.toContain('PDFFormatVersion');
    expect(out.files[1]).toMatchObject({ path: 'original/PA-02 Residuos.pdf', mime: 'application/pdf', encoding: 'base64' });
    expect(out.source).toEqual({ original: 'original/PA-02 Residuos.pdf' });
    expect(transcribePdf).not.toHaveBeenCalled();
  });

  it('transcribes a scan (only page markers and stray bullets come back)', async () => {
    transcribePdf.mockResolvedValue('# Matriz de riesgos\n\n| Tarea | Riesgo |\n|---|---|\n| Izaje | Alto |');
    const out = await convertPdfImport(envWith(TO_MD('-\n\n- •\n\n- •')), 'RS-01-02 Matriz.pdf', BYTES);
    expect(transcribePdf).toHaveBeenCalledOnce();
    expect(out.type).toBe('markdown');
    expect(out.files[0].content).toContain('| Izaje | Alto |');
  });

  it('keeps the little text it found when transcription is unavailable', async () => {
    const out = await convertPdfImport(envWith(TO_MD('Plano general.')), 'plano.pdf', BYTES);
    expect(out.type).toBe('markdown');
    expect(out.files[0].content).toContain('Plano general.');
  });

  it('stays a PDF artifact when nothing can be read, so the upload is never lost', async () => {
    const out = await convertPdfImport({} as Env, 'scan.pdf', BYTES);
    expect(out.type).toBe('pdf');
    expect(out.files).toEqual([{ path: 'scan.pdf', content: 'JVBERi0xLjQgeA==', mime: 'application/pdf', encoding: 'base64' }]);
    expect(out.entrypoint).toBe('scan.pdf');
    expect(out.source).toBeUndefined();
  });
});
