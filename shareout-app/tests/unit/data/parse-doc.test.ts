// Legacy Word (.doc) text extraction: a real Word 97 file plus synthetic piece tables.
import { describe, expect, it } from 'vitest';
import { DOC_IMAGES_ONLY, DOC_MAX_INPUT_BYTES, DocReadError, docToMarkdown, docToText } from '../../../src/data/files/parse-doc';
import { REAL_DOC, REAL_DOC_TEXT, buildDoc } from '../helpers/doc-fixtures';

const fails = (bytes: Uint8Array, message: string) => {
  expect(() => docToText(bytes)).toThrow(DocReadError);
  expect(() => docToText(bytes)).toThrow(message);
};

describe('docToText / docToMarkdown', () => {
  it('reads a real Word 97 file (UTF-16 piece, accents, non-Latin-1, a table)', () => {
    expect(docToMarkdown(REAL_DOC())).toBe(REAL_DOC_TEXT);
  });

  it('reads 8-bit (Windows-1252) and UTF-16 pieces in order', () => {
    const doc = buildDoc([
      { text: 'Clasificación it’s\r', compressed: true },
      { text: 'Œuvre → next\r', compressed: false },
    ]);
    expect(docToText(doc)).toBe('Clasificación it’s\nŒuvre → next');
  });

  it('keeps a field’s displayed result and drops its code', () => {
    const doc = buildDoc([{ text: 'See \x13 HYPERLINK "https://x.test" \x14the guide\x15 now.\rPage \x13PAGE\x15 end\r', compressed: true }]);
    expect(docToText(doc)).toBe('See the guide now.\nPage  end');
  });

  it('table cells become " | " and rows lines', () => {
    const doc = buildDoc([{ text: 'A\x07B\x07\x07C\x07D\x07\x07', compressed: true }]);
    expect(docToMarkdown(doc)).toBe('A | B\n\nC | D');
  });

  it('fails with a clear reason on files it cannot read', () => {
    fails(new Uint8Array([1, 2, 3]), 'could not be opened');
    fails(buildDoc([{ text: 'x\r', compressed: true }], { flags: 0x0300 }), 'password-protected');
    fails(buildDoc([{ text: 'x\r', compressed: true }], { nFib: 0x65 }), 'Word 6/95');
    fails(new Uint8Array(DOC_MAX_INPUT_BYTES + 1), 'up to 8 MB');
  });
});

describe('docToText stories beyond the main body', () => {
  const main = '\x08\x08\r'; // a body that only anchors two shapes
  const hdd = 'Form A-1 rev. 2\r\r';
  const txbx = 'Step one\rStep two\r';

  it('reads text boxes and headers after the main story, blank-line separated', () => {
    const doc = buildDoc([{ text: 'Intro\r' + hdd + txbx, compressed: true }], { stories: { hdd: hdd.length, txbx: txbx.length } });
    expect(docToText(doc)).toBe('Intro\n\nForm A-1 rev. 2\n\nStep one\nStep two');
  });

  it('a body that is only shapes still yields the text-box and footnote text', () => {
    const ftn = 'A note\r';
    const doc = buildDoc([
      { text: main + ftn, compressed: true },
      { text: hdd + txbx, compressed: false },
    ], { stories: { ftn: ftn.length, hdd: hdd.length, txbx: txbx.length } });
    expect(docToMarkdown(doc)).toBe('A note\n\nForm A-1 rev. 2\n\nStep one\n\nStep two');
  });

  it('reads header text boxes and endnotes', () => {
    const edn = 'End\r';
    const hdrTxbx = 'Logo caption\r';
    const doc = buildDoc([{ text: 'Body\r' + edn + hdrTxbx, compressed: true }], { stories: { edn: edn.length, hdrTxbx: hdrTxbx.length } });
    expect(docToText(doc)).toBe('Body\n\nEnd\n\nLogo caption');
  });

  it('pictures or shapes with no text anywhere but headers → images/drawings only', () => {
    fails(buildDoc([{ text: main + hdd, compressed: true }], { stories: { hdd: hdd.length } }), DOC_IMAGES_ONLY);
    fails(buildDoc([{ text: '\x01\r', compressed: true }]), DOC_IMAGES_ONLY);
  });

  it('an empty document without pictures still returns empty text', () => {
    expect(docToText(buildDoc([{ text: '\r', compressed: true }]))).toBe('');
    expect(docToText(buildDoc([{ text: '\r' + hdd, compressed: true }], { stories: { hdd: hdd.length } }))).toBe('Form A-1 rev. 2');
  });
});

describe('docToText on damaged input', () => {
  it('never throws anything but DocReadError, and never hangs', () => {
    const good = buildDoc([{ text: 'Hello world\r', compressed: true }]);
    for (let i = 0; i < 40; i++) {
      const bad = good.slice();
      // Corrupt a spread of bytes across the CFB (headers, FIB, piece table).
      for (let j = 0; j < 24; j++) bad[(i * 7919 + j * 104729) % bad.length] ^= 0xff;
      try { docToText(bad); } catch (e) { expect(e).toBeInstanceOf(DocReadError); }
    }
    expect(() => docToText(good.slice(0, good.length / 2))).toThrow(DocReadError);
  });
});
