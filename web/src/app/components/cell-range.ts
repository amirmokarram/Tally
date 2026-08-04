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
 * The rectangle a fill handle drag makes: the base selection stretched by
 * exactly one edge, toward wherever the pointer is now.
 *
 * A spreadsheet's fill handle only ever grows a selection in the single
 * direction dragged furthest past it — up, down, left or right, never two at
 * once — so this reads all four overshoots and moves only the edge with the
 * largest. A pointer that never left the base rectangle overshoots nothing;
 * `base` comes back unchanged, which is what makes a click of the handle
 * without a drag a no-op rather than a fill of nothing.
 */
export function extendRange(base: RangeBounds, target: CellRef): RangeBounds {
  const down = target.row - base.bottom;
  const up = base.top - target.row;
  const right = target.col - base.right;
  const left = base.left - target.col;
  const most = Math.max(down, up, right, left, 0);

  if (most <= 0) {
    return base;
  }
  if (most === down) {
    return { ...base, bottom: target.row };
  }
  if (most === up) {
    return { ...base, top: target.row };
  }
  if (most === right) {
    return { ...base, right: target.col };
  }
  return { ...base, left: target.col };
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
