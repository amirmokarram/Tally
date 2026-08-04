/**
 * The selected rectangle and the clipboard's text format.
 *
 * Both are the app's own — AG Grid's range selection and clipboard are
 * Enterprise — so both are pinned here, away from a grid.
 */

import {
  CellRange,
  extendRange,
  fromClipboardText,
  isSingleCell,
  rangeBounds,
  rangeHas,
  toClipboardText,
} from './cell-range';

function range(anchorRow: number, anchorCol: number, headRow: number, headCol: number): CellRange {
  return { anchor: { row: anchorRow, col: anchorCol }, head: { row: headRow, col: headCol } };
}

describe('the selected block', () => {
  it('is the rectangle between the two corners, dragged either way', () => {
    const downRight = rangeBounds(range(1, 2, 4, 5));
    const upLeft = rangeBounds(range(4, 5, 1, 2));

    // A drag that started at the bottom right covers the same cells.
    expect(downRight).toEqual({ top: 1, left: 2, bottom: 4, right: 5 });
    expect(upLeft).toEqual(downRight);
  });

  it('holds the cells inside it and no others', () => {
    const block = range(1, 1, 3, 2);

    expect(rangeHas(block, 1, 1)).toBe(true);
    expect(rangeHas(block, 3, 2)).toBe(true);
    expect(rangeHas(block, 2, 2)).toBe(true);
    expect(rangeHas(block, 0, 1)).toBe(false);
    expect(rangeHas(block, 2, 3)).toBe(false);
  });

  it('knows a single cell, which is what makes a paste land rather than fill', () => {
    expect(isSingleCell(range(2, 2, 2, 2))).toBe(true);
    expect(isSingleCell(range(2, 2, 2, 3))).toBe(false);
  });
});

describe('a fill handle drag', () => {
  const base = rangeBounds(range(1, 1, 2, 2)); // rows 1–2, cols 1–2

  it('grows the edge dragged furthest past, and no other', () => {
    expect(extendRange(base, { row: 4, col: 2 })).toEqual({ top: 1, left: 1, bottom: 4, right: 2 });
    expect(extendRange(base, { row: 1, col: 5 })).toEqual({ top: 1, left: 1, bottom: 2, right: 5 });
    expect(extendRange(base, { row: -3, col: 1 })).toEqual({ top: -3, left: 1, bottom: 2, right: 2 });
    expect(extendRange(base, { row: 2, col: -2 })).toEqual({ top: 1, left: -2, bottom: 2, right: 2 });
  });

  it('picks the single largest overshoot when the drag went two ways', () => {
    // Three past the bottom, one past the right — down wins.
    expect(extendRange(base, { row: 5, col: 3 })).toEqual({ top: 1, left: 1, bottom: 5, right: 2 });
  });

  it('does nothing for a pointer still inside the base rectangle', () => {
    expect(extendRange(base, { row: 2, col: 2 })).toEqual(base);
    expect(extendRange(base, { row: 1, col: 1 })).toEqual(base);
  });
});

describe('the clipboard format', () => {
  it('writes tabs between cells and newlines between rows', () => {
    expect(
      toClipboardText([
        ['Beer', '15'],
        ['Pizza', '19.8'],
      ]),
    ).toBe('Beer\t15\nPizza\t19.8');
  });

  it('reads back what it writes', () => {
    const rows = [
      ['Beer', '15'],
      ['', '19.8'],
    ];
    expect(fromClipboardText(toClipboardText(rows))).toEqual(rows);
  });

  it('reads the carriage returns and trailing newline a spreadsheet adds', () => {
    // Excel ends its last row too. Kept, that row of blanks would paste over —
    // and wipe — the line under the block.
    expect(fromClipboardText('1\t2\r\n3\t4\r\n')).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('keeps a single empty cell, which clears what it is pasted over', () => {
    expect(fromClipboardText('')).toEqual([['']]);
  });
});
