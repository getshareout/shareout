// PDF → editable Markdown page on import: text layer via toMarkdown, scans via a vision
// model, and a PDF artifact when neither yields text.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const transcribePdf = vi.fn();
const transcribeDocument = vi.fn();
vi.mock('../../../src/data/files/transcribe-pdf', () => ({
  transcribePdf: (...a: unknown[]) => transcribePdf(...a),
  transcribeDocument: (...a: unknown[]) => transcribeDocument(...a),
}));
const docToMarkdown = vi.fn();
vi.mock('../../../src/data/files/parse-doc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/data/files/parse-doc')>()),
  docToMarkdown: (...a: unknown[]) => docToMarkdown(...a),
}));

const { convertPdfImport, pdfMarkdownBody, convertOfficeImport, embeddedImages } = await import('../../../src/pages/home/import-office');
const { pptxTextImport } = await import('../../../src/pages/home/import-slides');
const { DOC_IMAGES_ONLY, DocReadError } = await import('../../../src/data/files/parse-doc');
const { zipSync, strToU8 } = await import('fflate');

const BYTES = new TextEncoder().encode('%PDF-1.4 x');
const PROSE = 'El presente procedimiento establece la metodología para la gestión de residuos generados en obra, incluyendo su clasificación, almacenamiento temporal, transporte y disposición final conforme a la normativa vigente. '.repeat(2);
const TO_MD = (body: string) => `# PA-02.pdf\n## Metadata\n- PDFFormatVersion=1.4\n- IsLinearized=false\n## Contents\n### Page 1\n${body}\n### Page 2\nFin.`;
const envWith = (data: string | null) => ({ AI: { toMarkdown: async () => (data === null ? { format: 'error' } : { format: 'markdown', data }) } }) as unknown as Env;

beforeEach(() => { transcribePdf.mockReset().mockResolvedValue(null); transcribeDocument.mockReset().mockResolvedValue(null); docToMarkdown.mockReset(); });

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (size: number) => [...PNG_SIG, ...new Array(size).fill(1), 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

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

describe('Word files that are only pictures', () => {
  it('finds whole PNGs inside a binary, skipping icons', () => {
    const bytes = new Uint8Array([0, 0, ...png(12_000), 7, ...png(200), 9]);
    const imgs = embeddedImages(bytes);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].mediaType).toBe('image/png');
    expect(atob(imgs[0].data).length).toBe(12_000 + 16);
  });

  it('transcribes the pictures of an image-only .doc', async () => {
    docToMarkdown.mockImplementation(() => { throw new DocReadError(DOC_IMAGES_ONLY); });
    transcribeDocument.mockResolvedValue('| Severidad | A |\n|---|---|\n| V | 4 |');
    const out = await convertOfficeImport({} as Env, 'RS-01-02 Matriz.doc', 'doc', 'word', new Uint8Array(png(12_000)));
    expect(transcribeDocument).toHaveBeenCalledWith({}, [expect.objectContaining({ mediaType: 'image/png' })]);
    expect(out.files[0].content).toContain('| V | 4 |');
  });

  it('still fails clearly when nothing can be read', async () => {
    docToMarkdown.mockImplementation(() => { throw new DocReadError(DOC_IMAGES_ONLY); });
    await expect(convertOfficeImport({} as Env, 'x.doc', 'doc', 'word', new Uint8Array(png(12_000)))).rejects.toMatchObject({ code: 'CONVERT_FAILED' });
  });
});

describe('a .pptx without the slides converter', () => {
  it('becomes a Markdown page of its slide text with the deck kept', () => {
    const deck = zipSync({
      'ppt/slides/slide1.xml': strToU8('<p:sld><p:txBody><a:p><a:t>Advertencia</a:t></a:p><a:p><a:t>Detener la tarea</a:t></a:p></p:txBody></p:sld>'),
    });
    const out = pptxTextImport('RS-02-03 Advertencia.pptx', deck);
    expect(out.type).toBe('markdown');
    expect(out.entrypoint).toBe('RS-02-03 Advertencia.md');
    expect(out.files[0].content).toContain('## 1. Advertencia');
    expect(out.files[0].content).toContain('Detener la tarea');
    expect(out.files[1]).toMatchObject({ path: 'original/RS-02-03 Advertencia.pptx', encoding: 'base64' });
  });
});
