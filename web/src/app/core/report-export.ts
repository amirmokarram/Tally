/**
 * Rasterizing the live report to a PNG and handing it to the browser.
 *
 * Kept apart from `split-grid.ts`: it is already the largest component's
 * file by a wide margin, and neither of these two steps — cloning a DOM node
 * to an image, saving a blob — has anything to do with the grid itself. The
 * caller (`SplitGrid.savePng`) is responsible for putting the report into its
 * flattened, print-ready shape first (no toolbar, no scroll, no add-item
 * rows) before handing the node here; this file only turns *whatever DOM it's
 * given* into a file on disk.
 */

import { toBlob } from 'html-to-image';

import { downloadBlob } from './trip-file';

/** Rasterizes a live DOM node to a PNG blob. */
export async function capturePng(node: HTMLElement): Promise<Blob> {
  const blob = await toBlob(node, { pixelRatio: 2 });
  if (!blob) {
    throw new Error('Could not render the report as an image.');
  }
  return blob;
}

/**
 * Saves a blob as a named file, through the browser's own "Save As" dialog
 * where one exists (`showSaveFilePicker` — Chrome/Edge) and by the same
 * throwaway-anchor download every other export in this app uses everywhere
 * else (`downloadBlob`, `trip-file.ts`).
 *
 * A picker the user cancels rejects with an `AbortError` — not a failure of
 * the capture, so it is swallowed here rather than surfaced as one.
 */
export async function saveImageFile(blob: Blob, fileName: string): Promise<void> {
  const showSaveFilePicker = (
    window as typeof window & {
      showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;

  if (!showSaveFilePicker) {
    downloadBlob(fileName, blob);
    return;
  }

  let handle: FileSystemFileHandle;
  try {
    handle = await showSaveFilePicker({
      suggestedName: fileName,
      types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return;
    }
    throw error;
  }

  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}
