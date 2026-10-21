/**
 * Slide decks (.pptx/.ppt/.odp) → a PDF artifact on import (POST /v1/home/import).
 * LibreOffice runs in the optional SLIDES_CONVERTER container (slides-converter-do.ts);
 * the original deck is kept next to the PDF for download, like Word/Excel imports.
 * Without the converter a .pptx becomes a Markdown page of its slide text instead.
 */
import type { Env } from '../../types';
import { parsePptx } from '../../data/files/parse-pptx';
import { type ConvertedImport, ImportError, bytesToBase64, originalFile, safeSegment } from './import-office';

/** Worker-side ceiling; the container kills LibreOffice a bit earlier (server.py). */
export const SLIDES_TIMEOUT_MS = 90_000;

const RETRY = 'Export it as PDF from PowerPoint, Keynote or Google Slides and drop that instead.';

export async function convertSlidesImport(env: Env, filename: string, ext: string, bytes: Uint8Array, timeoutMs = SLIDES_TIMEOUT_MS): Promise<ConvertedImport> {
  if (!env.SLIDES_CONVERTER && ext === 'pptx') return pptxTextImport(filename, bytes);
  if (!env.SLIDES_CONVERTER) throw new ImportError('CONVERT_UNAVAILABLE', `This server can’t convert slide decks. ${RETRY}`);
  const stub = env.SLIDES_CONVERTER.get(env.SLIDES_CONVERTER.idFromName('slides'));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, no) => {
    timer = setTimeout(() => no(new ImportError('CONVERT_TIMEOUT', `This deck took too long to convert. ${RETRY}`)), timeoutMs);
  });
  let pdf: Uint8Array;
  try {
    const res = await Promise.race([
      stub.fetch('http://slides/convert', { method: 'POST', body: bytes, headers: { 'content-type': 'application/octet-stream', 'x-ext': ext } }),
      timeout,
    ]);
    if (res.status === 413) throw new ImportError('FILE_TOO_LARGE', 'This deck is too large to convert.', 413);
    if (res.status === 504) throw new ImportError('CONVERT_TIMEOUT', `This deck took too long to convert. ${RETRY}`);
    if (res.status === 503 || res.status === 429) throw new ImportError('CONVERT_BUSY', 'The converter is busy. Try again in a minute.', 503);
    if (!res.ok) throw new ImportError('CONVERT_FAILED', 'This deck could not be converted. Is it damaged?');
    pdf = new Uint8Array(await Promise.race([res.arrayBuffer(), timeout]));
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError('CONVERT_FAILED', 'This deck could not be converted. Is it damaged?');
  } finally {
    clearTimeout(timer);
  }
  if (new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-') throw new ImportError('CONVERT_FAILED', 'This deck could not be converted. Is it damaged?');

  const original = originalFile(filename, ext, bytes);
  const entrypoint = `${safeSegment(filename.replace(/\.[^.]+$/, ''), 'slides')}.pdf`;
  return {
    entrypoint,
    files: [{ path: entrypoint, content: bytesToBase64(pdf), mime: 'application/pdf', encoding: 'base64' }, original],
    source: { original: original.path },
  };
}

/** A .pptx as Markdown, one section per slide, with the deck kept for download. */
export function pptxTextImport(filename: string, bytes: Uint8Array): ConvertedImport {
  let slides: ReturnType<typeof parsePptx>;
  try { slides = parsePptx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer); } catch {
    throw new ImportError('CONVERT_FAILED', 'This deck could not be read. Is it damaged?');
  }
  const markdown = slides.map((s) => `## ${s.index}. ${s.title}\n\n${s.lines.join('\n\n')}`.trim()).join('\n\n');
  if (!markdown.trim()) throw new ImportError('CONVERT_FAILED', `This deck has no text. ${RETRY}`);
  const original = originalFile(filename, 'pptx', bytes);
  const entrypoint = `${safeSegment(filename.replace(/\.[^.]+$/, ''), 'slides')}.md`;
  return {
    entrypoint,
    files: [{ path: entrypoint, content: markdown, mime: 'text/markdown' }, original],
    source: { original: original.path },
    type: 'markdown',
  };
}
