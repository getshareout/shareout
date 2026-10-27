// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tableSortScript } from '../../../src/design-system/components/table-sort';

const col = (sel: string, i: number) => [...document.querySelectorAll(sel)].map((r) => (r.children[i] as HTMLElement).textContent!.trim());
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

beforeAll(() => { eval(tableSortScript); });

describe('table-sort: <table>', () => {
  beforeEach(() => {
    document.body.innerHTML = `<table><thead><tr><th>Name</th><th>Views</th><th>When</th><th></th></tr></thead><tbody>
      <tr><td>beta</td><td>1.2k</td><td data-sort="2026-10-01">3d ago</td><td>x</td></tr>
      <tr><td>Álpha</td><td>950</td><td data-sort="2026-10-03">1d ago</td><td>y</td></tr>
      <tr><td>—</td><td>12</td><td data-sort="">—</td><td>z</td></tr>
      <tr><td>item 10</td><td>$3.40</td><td data-sort="2026-09-30">4d ago</td><td>w</td></tr>
      <tr><td>item 9</td><td>2 MB</td><td data-sort="2026-10-02">2d ago</td><td>v</td></tr>
    </tbody></table>`;
  });
  const th = (i: number) => document.querySelectorAll('thead th')[i];

  it('sorts A→Z on first click and Z→A on the second, ignoring case/accents, blanks last both ways', () => {
    click(th(0));
    expect(col('tbody tr', 0)).toEqual(['Álpha', 'beta', 'item 9', 'item 10', '—']);
    expect(th(0).getAttribute('aria-sort')).toBe('ascending');
    click(th(0));
    expect(col('tbody tr', 0)).toEqual(['item 10', 'item 9', 'beta', 'Álpha', '—']);
    expect(th(0).getAttribute('aria-sort')).toBe('descending');
  });

  it('compares numbers with units, currency and compact suffixes numerically', () => {
    click(th(1));
    expect(col('tbody tr', 1)).toEqual(['$3.40', '12', '950', '1.2k', '2 MB']);
  });

  it('uses data-sort over the visible text and moves aria-sort to the clicked column', () => {
    click(th(0));
    click(th(2));
    expect(col('tbody tr', 2)).toEqual(['4d ago', '3d ago', '2d ago', '1d ago', '—']);
    expect(th(0).hasAttribute('aria-sort')).toBe(false);
    expect(th(2).getAttribute('aria-sort')).toBe('ascending');
  });

  it('ignores empty headers, data-nosort, and header rows a view sorts itself', () => {
    const before = col('tbody tr', 0);
    click(th(3));
    th(1).setAttribute('data-nosort', '');
    click(th(1));
    document.querySelector('thead tr')!.setAttribute('data-sort-own', '');
    click(th(0));
    expect(col('tbody tr', 0)).toEqual(before);
    expect(document.querySelector('[aria-sort]')).toBeNull();
  });
});

describe('table-sort: div tables', () => {
  it('sorts the rows after a .wsx-tbl__head, reading data-date when there is no data-sort', () => {
    document.body.innerHTML = `<div class="wsx-tbl"><div class="wsx-tbl__head"><span></span><span>Name</span><span>Updated</span></div>
      <a class="wsx-tr"><span>i</span><span>Zeta</span><span data-date="2026-01-02">Jan 2</span></a>
      <a class="wsx-tr"><span>i</span><span>alpha</span><span data-date="2026-03-01">Mar 1</span></a>
      <a class="wsx-tr"><span>i</span><span>Mid</span><span data-date="2025-12-31">Dec 31</span></a></div>`;
    const head = document.querySelectorAll('.wsx-tbl__head > span');
    click(head[1]);
    expect(col('.wsx-tr', 1)).toEqual(['alpha', 'Mid', 'Zeta']);
    click(head[2]);
    expect(col('.wsx-tr', 2)).toEqual(['Dec 31', 'Jan 2', 'Mar 1']);
    click(head[0]);
    expect(col('.wsx-tr', 2)).toEqual(['Dec 31', 'Jan 2', 'Mar 1']);
  });
});
