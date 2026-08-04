/**
 * The block of cells a copy or a paste applies to.
 *
 * AG Grid's own range selection and clipboard are Enterprise, and this app is
 * Community only (see the README), so the ledger brings its own: a rectangle
 * between the cell the drag started on and the one under the pointer, and the
 * tab-separated text every spreadsheet reads and writes.
 *
 * Nothing here imports AG Grid or Angular. A rectangle over two integer axes
 * and a TSV round trip are the parts with rules in them, so they live apart
 * from the grid that draws them and are tested directly.
 */

/**
 * A cell, addressed by display position rather than by id: the rectangle is
 * over what is on screen, and a column's *place* is what decides whether it
 * falls inside. `col` indexes the selectable columns, not every column.
 */
export interface CellRef {
  row: number;
  col: number;
}

/**
 * A selection, kept as the two cells that made it.
 *
 * The anchor is where the drag started and the head is where it is now — not
 * normalised to a top-left / bottom-right pair, because a drag that doubles
 * back has to shrink the rectangle, and only the anchor says which corner is
 * pinned.
 */
export interface CellRange {
  anchor: CellRef;
  head: CellRef;
}

export interface RangeBounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export function rangeBounds(range: CellRange): RangeBounds {
  const { anchor, head } = range;
  return {
    top: Math.min(anchor.row, head.row),
    left: Math.min(anchor.col, head.col),
    bottom: Math.max(anchor.row, head.row),
    right: Math.max(anchor.col, head.col),
  };
}

export function rangeHas(range: CellRange, row: number, col: number): boolean {
  const { top, left, bottom, right } = rangeBounds(range);
  return row >= top && row <= bottom && col >= left && col <= right;
}

/** True when the selection is a single cell — which paste treats as "start here". */
export function isSingleCell(range: CellRange): boolean {
  return range.anchor.row === range.head.row && range.anchor.col === range.head.col;
}

/**
 * The clipboard's own format: tab between cells, newline between rows.
 *
 * Plain `\n`, not `\r\n`. Excel and Sheets both read either, and a lone `\n` is
 * what a paste into a text editor should look like.
 */
export function toClipboardText(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.join('\t')).join('\n');
}

/**
 * Reads back what any spreadsheet puts on the clipboard.
 *
 * Both line endings are accepted because the source is not ours to choose, and
 * the trailing newline Excel adds is dropped — kept, it would paste a row of
 * blanks under everything and wipe the line below.
 */
export function fromClipboardText(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 1 && lines.at(-1) === '') {
    lines.pop();
  }
  return lines.map((line) => line.split('\t'));
}
