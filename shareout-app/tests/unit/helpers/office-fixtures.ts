// Small real Office files built in-test (no binary fixtures in the repo).
import { strToU8, zipSync } from 'fflate';
import * as XLSX from 'xlsx';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const run = (t: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const item = (numId: number, t: string, lvl = 0) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${run(t)}</w:p>`;
const cell = (t: string) => `<w:tc><w:p>${run(t)}</w:p></w:tc>`;

/** A 1×1 transparent PNG. */
export const PNG_1PX = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));

export function docxFixture(): Uint8Array {
  const body = [
    `<w:p><w:pPr><w:pStyle w:val="Ttulo1"/></w:pPr>${run('Quarterly plan')}</w:p>`,
    `<w:p>${run('We grew ')}${run('40%', '<w:b/>')}${run(' this quarter, ')}${run('mostly', '<w:i/>')}${run(' — see ')}<w:hyperlink r:id="rId9">${run('the report')}</w:hyperlink>${run('.')}</w:p>`,
    '<w:p/>',
    item(1, 'Hire two people'), item(1, 'Ship the app'), item(1, 'iOS first', 1), item(1, 'Then Android', 1), item(1, 'Celebrate'),
    `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${run('Numbers')}</w:p>`,
    `<w:tbl><w:tblPr/><w:tr>${cell('Region')}${cell('Sales')}</w:tr><w:tr>${cell('North')}${cell('120')}</w:tr></w:tbl>`,
    item(2, 'Idea'),
    `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1" descr="Logo"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
  ].join('');
  const numbering = `<w:numbering ${W}>`
    + '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>'
    + '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>'
    + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>';
  const styles = `<w:styles ${W}><w:style w:type="paragraph" w:styleId="Ttulo1"><w:name w:val="heading 1"/></w:style></w:styles>`;
  const rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>'
    + '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/report" TargetMode="External"/>'
    + '</Relationships>';
  return zipSync({
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`),
    'word/numbering.xml': strToU8(numbering),
    'word/styles.xml': strToU8(styles),
    'word/_rels/document.xml.rels': strToU8(rels),
    'word/media/image1.png': PNG_1PX,
  });
}

export const DOCX_MARKDOWN = [
  '# Quarterly plan',
  '',
  'We grew **40%** this quarter, *mostly* — see [the report](https://example.com/report).',
  '',
  '1. Hire two people',
  '2. Ship the app',
  '  - iOS first',
  '  - Then Android',
  '3. Celebrate',
  '',
  '## Numbers',
  '',
  '| Region | Sales |',
  '| --- | --- |',
  '| North | 120 |',
  '',
  '- Idea',
  '',
  '![Logo](media/image1.png)',
  '',
].join('\n');

export function xlsxFixture(sheets: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
