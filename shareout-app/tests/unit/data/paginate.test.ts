import { describe, expect, it } from 'vitest';
import { readDatasetPage, parseCSVLine, DatasetTooLargeError } from '../../../src/data/datasets/paginate';

// Stream a string as Uint8Array chunks of `chunkSize` bytes. A tiny chunk size forces
// records (and JSON tokens) to straddle chunk boundaries, which is exactly where a
// streaming parser breaks if its state isn't carried across reads.
function streamOf(s: string, chunkSize = 3): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(s);
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
}

const read = (s: string, fmt: string, offset: number, limit: number, chunk = 3, opts = {}) =>
  readDatasetPage(streamOf(s, chunk), fmt, offset, limit, opts);

describe('parseCSVLine', () => {
  it('splits on commas, honours quotes and escaped quotes, trims values', () => {
    expect(parseCSVLine('Alice,"hello, world","say ""hi"""')).toEqual([
      'Alice', 'hello, world', 'say "hi"',
    ]);
  });
});

describe('readDatasetPage — JSON arrays', () => {
  const data = JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);

  it('paginates with correct total/window', async () => {
    const { page, total } = await read(data, 'json', 1, 2);
    expect(total).toBe(5);
    expect(page).toEqual([{ id: 2 }, { id: 3 }]);
  });

  it('offset past the end returns an empty page but the real total', async () => {
    const { page, total } = await read(data, 'json', 99, 10);
    expect(page).toEqual([]);
    expect(total).toBe(5);
  });

  it('empty array has total 0', async () => {
    const { page, total } = await read('[]', 'json', 0, 10);
    expect(page).toEqual([]);
    expect(total).toBe(0);
  });

  it('handles strings containing commas, brackets, braces and escaped quotes', async () => {
    const tricky = JSON.stringify([
      { a: 'x,y]z}{' },
      { a: 'he said "hi"' },
      { a: 'line\nbreak' },
    ]);
    const { page, total } = await read(tricky, 'json', 0, 10, 1); // chunk=1: maximal stress
    expect(total).toBe(3);
    expect(page).toEqual([
      { a: 'x,y]z}{' },
      { a: 'he said "hi"' },
      { a: 'line\nbreak' },
    ]);
  });

  it('handles nested objects/arrays as elements', async () => {
    const nested = JSON.stringify([
      { id: 1, tags: ['a', 'b'], meta: { n: { deep: [1, 2] } } },
      { id: 2, tags: [] },
    ]);
    const { page, total } = await read(nested, 'json', 0, 10, 2);
    expect(total).toBe(2);
    expect(page[0]).toEqual({ id: 1, tags: ['a', 'b'], meta: { n: { deep: [1, 2] } } });
  });

  it('handles primitive elements and whitespace between them', async () => {
    const { page, total } = await read('[ 1,\n 2 ,\t3 ]', 'json', 0, 10, 1);
    expect(total).toBe(3);
    expect(page).toEqual([1, 2, 3]);
  });

  it('handles string elements', async () => {
    const { page } = await read('["a","b,c","d]e"]', 'json', 0, 10, 1);
    expect(page).toEqual(['a', 'b,c', 'd]e']);
  });

  it('wraps a single non-array JSON object as one row', async () => {
    const { page, total } = await read('{"id":1,"v":"solo"}', 'json', 0, 10);
    expect(total).toBe(1);
    expect(page).toEqual([{ id: 1, v: 'solo' }]);
  });

  it('throws DatasetTooLargeError when a single non-array value exceeds the cap', async () => {
    const big = JSON.stringify({ blob: 'x'.repeat(200) });
    await expect(read(big, 'json', 0, 10, 7, { maxSingleValueBytes: 50 }))
      .rejects.toBeInstanceOf(DatasetTooLargeError);
  });
});

describe('readDatasetPage — CSV', () => {
  const csv = 'name,amount\nAlice,10\nBob,20\nCarol,30\n';

  it('paginates rows, zipping values to headers', async () => {
    const { page, total } = await read(csv, 'csv', 1, 1);
    expect(total).toBe(3);
    expect(page).toEqual([{ name: 'Bob', amount: '20' }]);
  });

  it('parses quoted fields with embedded commas and quotes', async () => {
    const q = 'name,note\nAlice,"hello, world"\nBob,"say ""hi"""\n';
    const { page, total } = await read(q, 'csv', 0, 10, 2);
    expect(total).toBe(2);
    expect(page).toEqual([
      { name: 'Alice', note: 'hello, world' },
      { name: 'Bob', note: 'say "hi"' },
    ]);
  });

  it('handles a trailing row with no newline and skips blank lines', async () => {
    const { page, total } = await read('a,b\n\n1,2\n\n3,4', 'csv', 0, 10, 1);
    expect(total).toBe(2);
    expect(page).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }]);
  });

  it('pads missing trailing values with empty strings', async () => {
    const { page } = await read('a,b,c\n1,2\n', 'csv', 0, 10);
    expect(page).toEqual([{ a: '1', b: '2', c: '' }]);
  });
});
