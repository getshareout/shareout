// Legacy Word (.doc) fixtures. REAL_DOC is a genuine Word 97 binary written by macOS
// `textutil -convert doc` from a small HTML page (headings, accents, a non-Latin-1
// piece, a 2x2 table); its expected text is REAL_DOC_TEXT. buildDoc() writes a minimal
// synthetic .doc (FIB + piece table in a CFB) to cover 8-bit pieces, fields and flags.
import { gunzipSync } from 'fflate';
import * as XLSX from 'xlsx';
import { base64ToBytes } from '../../../src/pages/home/import-office';

export const REAL_DOC_TEXT = 'Procedimiento de clasificación\n\nPrimer párrafo con acentos: ñandú, «comillas».\n\nUnicode piece: Ω → ≈ 5€.\n\nA1 | B1\n\nA2 | B2\n\nLast line.';

/** gzip'd so the 19 KB of mostly-zero CFB sectors stay small in source. */
export const REAL_DOC = () => gunzipSync(base64ToBytes('H4sIAAAAAAACA+2cT2wUVRzHvzO73e5WbKcVSi2K09ooiYQUtIkxhrCKiGigWIznZbulTbalaUuwt15MPPrn4MVEIfZgMCZG4sWDVS9e+HMAE6qHwgmQhAVjDCR2/P7evHVnuy3skgZo+vs0v3nv996833ud92bn9yb727NnmueOfdt+EQvYjhjmgxQSkTKH0lFUPOBpWzYfBIEU+ZRAWVFcm/7JTmih5cdwlps5qY6Z+HqgEf0ES9AqJ6DvvVCmcGeCoOmu+SJ5czxuteO4O3LOWlTP95Q1lJ9tWuQ65SoeHBd4S/luSZ+lrIPysHN6wTpSlIefXozhMLLIoR9DGKbkMIIJlvksyfGY5WdxBuOsGaBkmc8y/YtnPWpaS6scUx+juMh0jGcMmPZZHkeYZoz90Oo4XmLJDZaN0P5tbKZ2wpwpfedtXz9gC62/w3OGTF04klEzOrElNr6K+fi4w8fuTh89+NqXFmls5UPrFXOsp7bNaNuM9paxPMGWedoZoRVpserhc3475TTlHOUPyiXKVfv8/6dw5dLv507pdbrvrNm3J4b9lFf3tC2X1lTSutGTdDjDC+Z/NrIGLkfWwe3o0P6OKoWo8mdUKVs1v0aVX6LKdFT5YoXNUh2dzi8LSHdhI93hLmd9l5P8rRv03+a8mY6pROWOaLEyxE1jWinlltteaaQmlza1qaKfr6xKHL0Eq5sWNKGBy2CIqYuY+XsB2HEjcCXlx8Ne+l9j9M4yZk/uml22PEzkUdJrHyfDu1PxStsvI73jZnCMqbwp2EmPa4BWjtCOeGG9zIuveMgcRzHIsl3GY5yosDRl3xPIeyZztJ9acevBSL4ukpfE9coah2+ypMHriQ+rWvYHrGs7zoHtZXqU6dvGURXnFeihHbcKO32YZJuDbCkX8Pkqe08b1zpTU5vSiOVlXBzdyQ/aUDjLQQ6a9rNv5p8RqbzzHaPHEfOcitJiiR9DwdM75h6ZTszUn8RJrsaW7uW3Luuws3QLcp6SeskVRVEURVEURSlnnjvqeEPl7lJK5t7//OatfYPeiY+SeO7Z7y7IvqXN1ol4duNx5V+9joqiKIqiKIqiKIqyUvf/7vlT5z/bssH75FPu/zff+kb3/4qiKIqiKIqiKIqyMnHsHj6G8Mvx8i36YkiQ/K5DimkD5RGE0c0SMdlIabL1zZAYAuAxhNH3EqneSllv6x9n2k7ZQHmC8iRlI+UpWy/SGcnP608y3FckoOGwicd4zURejGGypvXTijqnaEvWUCIVhkTMhNW7FmvThdJvRWzFAWRwEHnk7mn9NnL1lkW+VYH5aryNZHjXRLf0Y6eJgj5iwicWi0BZina4jtxDtfSPSP916DO9DptomEm8wd4H/o+4mcCQiYhZmk3s37X3brX9e2X9L/zPaxvPi+y/1uvfFulfURRFeTD8ByW191gATAAA'));

export interface DocPiece { text: string; compressed: boolean }

export function buildDoc(pieces: DocPiece[], opts: { flags?: number; nFib?: number } = {}): Uint8Array {
  const fibSize = 0x400;
  const enc = (p: DocPiece) => {
    const out = new Uint8Array(p.text.length * (p.compressed ? 1 : 2));
    for (let i = 0; i < p.text.length; i++) {
      const c = p.text.charCodeAt(i);
      if (p.compressed) out[i] = c === 0x2019 ? 0x92 : c;
      else { out[i * 2] = c & 0xff; out[i * 2 + 1] = c >> 8; }
    }
    return out;
  };
  const bodies = pieces.map(enc);
  const word = new Uint8Array(fibSize + bodies.reduce((n, b) => n + b.length, 0));
  const dv = new DataView(word.buffer);
  const ccp = pieces.reduce((n, p) => n + p.text.length, 0);
  dv.setUint16(0, 0xa5ec, true);
  dv.setUint16(2, opts.nFib ?? 0xc1, true);
  dv.setUint16(0x0a, opts.flags ?? 0x0200, true);
  dv.setUint16(32, 14, true); // csw
  const lw = 34 + 28;
  dv.setUint16(lw, 22, true); // cslw
  dv.setInt32(lw + 2 + 12, ccp, true); // ccpText
  const fl = lw + 2 + 88;
  dv.setUint16(fl, 93, true); // cbRgFcLcb (Word 97)
  // Piece table in the 1Table stream.
  const n = pieces.length;
  const lcb = (n + 1) * 4 + n * 8;
  const table = new Uint8Array(5 + lcb);
  const tv = new DataView(table.buffer);
  tv.setUint8(0, 0x02);
  tv.setUint32(1, lcb, true);
  let cp = 0;
  let fc = fibSize;
  pieces.forEach((p, i) => {
    tv.setUint32(5 + i * 4, cp, true);
    cp += p.text.length;
    const pcd = 5 + (n + 1) * 4 + i * 8;
    tv.setUint32(pcd + 2, p.compressed ? (fc * 2) | 0x40000000 : fc, true);
    word.set(bodies[i], fc);
    fc += bodies[i].length;
  });
  tv.setUint32(5 + n * 4, cp, true);
  dv.setUint32(fl + 2 + 33 * 8, 0, true); // fcClx
  dv.setUint32(fl + 2 + 33 * 8 + 4, table.length, true); // lcbClx
  const cfb = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(cfb, 'WordDocument', word);
  XLSX.CFB.utils.cfb_add(cfb, '1Table', table);
  const out = XLSX.CFB.write(cfb, { type: 'array' }) as ArrayLike<number>;
  return out instanceof Uint8Array ? out : Uint8Array.from(out);
}
