/**
 * AG Grid's look, expressed in the app's own design tokens.
 *
 * The colours are *mirrored* from `styles.scss` rather than referenced as
 * `var(--navy-800)`, and that is deliberate: AG Grid's Theming API derives
 * shades from these values (hover states, spanned-cell borders, the pinned
 * row's edge), and colour mixing cannot see through a CSS custom property —
 * `var(...)` arrives as an opaque string and every derived shade comes out
 * wrong or blank.
 *
 * So this file is the one place the palette is written twice. If a token in
 * `styles.scss` changes, change it here too.
 */

import { themeQuartz } from 'ag-grid-community';

/** Mirrors `:root` in `styles.scss`. */
const TOKENS = {
  navy800: '#1b4681',
  navy700: '#2b5ea6',
  navy050: '#eef4fc',
  surface: '#ffffff',
  surfaceAlt: '#f8fafd',
  border: '#d8dfea',
  text: '#16233a',
  textMuted: '#5c6b83',
  textInvert: '#ffffff',
} as const;

/**
 * Every ledger row is this tall.
 *
 * Fixed rather than auto, and shared rather than inlined, because a spanned
 * Sheet cell's height has to be worked out from a row count — see
 * `sheet-cell.ts`, which re-applies it.
 */
export const LEDGER_ROW_HEIGHT = 38;

export const ledgerTheme = themeQuartz.withParams({
  accentColor: TOKENS.navy700,
  backgroundColor: TOKENS.surface,
  foregroundColor: TOKENS.text,
  borderColor: TOKENS.border,

  headerBackgroundColor: TOKENS.navy800,
  headerTextColor: TOKENS.textInvert,
  headerFontWeight: 600,
  headerFontSize: 13,

  oddRowBackgroundColor: TOKENS.surfaceAlt,
  rowHoverColor: TOKENS.navy050,
  selectedRowBackgroundColor: TOKENS.navy050,

  // The app is 10px/6px throughout; the grid should not look like a widget
  // borrowed from somewhere else.
  wrapperBorderRadius: 10,
  borderRadius: 6,

  fontFamily: 'inherit',
  fontSize: 14,

  // A ledger is read down columns, so the vertical rules earn their keep here
  // in a way they would not in a plain list.
  columnBorder: true,
});
