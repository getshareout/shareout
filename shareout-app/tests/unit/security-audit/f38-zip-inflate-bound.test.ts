import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { docxToMarkdown, workbookToCsvSheets, ImportError } from '../../../src/pages/home/import-office';
import { parsePptx } from '../../../src/data/files/parse-pptx';
import { parseXlsx } from '../../../src/data/files/parse-xlsx';
import { ZIP_MAX_ENTRIES, unzipBounded } from '../../../src/data/files/unzip-bounded';

const enc = (s: string) => new TextEncoder().encode(s);
const DOC = enc('<w:document><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>');
const bomb = (mb: number) => new Uint8Array(mb * 1024 * 1024);

describe('f38 zip inflation bound', () => {
  it('blocks: docx with a 70MB hidden entry is refused', () => {
    const zip = zipSync({ 'word/document.xml': DOC, 'junk.bin': bomb(70) }, { level: 9 });
    expect(zip.length).toBeLessThan(200_000);
    expect(() => docxToMarkdown(zip)).toThrow(ImportError);
  });

  it('blocks: pptx with 70MB slide xml is refused', () => {
    const zip = zipSync({ 'ppt/slides/slide1.xml': bomb(70) }, { level: 9 });
    expect(() => parsePptx(zip.buffer as ArrayBuffer)).toThrow();
  });

  it('blocks: xlsx-shaped zip that inflates past the cap is refused before SheetJS', () => {
    const zip = zipSync({ 'xl/junk.bin': bomb(70) }, { level: 9 });
    expect(() => workbookToCsvSheets(zip)).toThrow(/expands/);
    expect(() => parseXlsx(zip.buffer as ArrayBuffer)).toThrow();
  });

  it('blocks: an archive with too many entries is refused', () => {
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i <= ZIP_MAX_ENTRIES; i++) many[`f${i}.txt`] = new Uint8Array(1);
    expect(() => unzipBounded(zipSync(many))).toThrow();
  });

  it('a normal docx and slide deck still read', () => {
    const docx = zipSync({ 'word/document.xml': DOC, 'word/media/a.png': new Uint8Array(1000) });
    expect(docxToMarkdown(docx).markdown).toContain('hello');
    const pptx = zipSync({
      'ppt/slides/slide1.xml': enc('<p:sld><a:p><a:t>Title</a:t></a:p><a:p><a:t>Line</a:t></a:p></p:sld>'),
      'ppt/media/big.bin': bomb(70),
    }, { level: 9 });
    expect(parsePptx(pptx.buffer as ArrayBuffer)).toEqual([{ index: 1, title: 'Title', lines: ['Line'] }]);
  });
});
