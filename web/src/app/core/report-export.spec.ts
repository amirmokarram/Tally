/**
 * `saveImageFile`'s two branches — a real capture through `html-to-image` is
 * left to the browser-only manual check (see `split-grid.spec.ts`'s own PNG
 * describe block); what's worth a unit test is which save path gets taken,
 * and that a user cancelling the native picker isn't treated as a failure.
 *
 * The fallback path is observed the same way `split-grid.spec.ts` already
 * observes `downloadJson` — spying on `HTMLAnchorElement.prototype.click`,
 * the DOM effect `downloadBlob` (`trip-file.ts`) actually produces — rather
 * than spying on `downloadBlob` itself: it's a plain named export, not a
 * class member, and ES module bindings are not reliably reassignable the way
 * `spyOn` needs.
 */

import { saveImageFile } from './report-export';

function withSaveFilePicker(picker: unknown): () => void {
  const win = window as typeof window & { showSaveFilePicker?: unknown };
  const original = win.showSaveFilePicker;
  win.showSaveFilePicker = picker;
  return () => {
    win.showSaveFilePicker = original;
  };
}

describe('saveImageFile', () => {
  const blob = new Blob(['x'], { type: 'image/png' });

  it('falls back to a plain download where there is no native picker', async () => {
    const restore = withSaveFilePicker(undefined);
    const clicked = spyOn(HTMLAnchorElement.prototype, 'click');

    try {
      await saveImageFile(blob, 'trip.png');
      expect(clicked).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('writes to the handle the native picker returns, without falling back', async () => {
    const write = jasmine.createSpy('write');
    const close = jasmine.createSpy('close');
    const showSaveFilePicker = jasmine.createSpy('showSaveFilePicker').and.resolveTo({
      createWritable: () => Promise.resolve({ write, close }),
    });
    const restore = withSaveFilePicker(showSaveFilePicker);
    const clicked = spyOn(HTMLAnchorElement.prototype, 'click');

    try {
      await saveImageFile(blob, 'trip.png');
      expect(showSaveFilePicker).toHaveBeenCalledWith(
        jasmine.objectContaining({ suggestedName: 'trip.png' }),
      );
      expect(write).toHaveBeenCalledWith(blob);
      expect(close).toHaveBeenCalled();
      expect(clicked).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('treats a cancelled picker as nothing to do, not a failure or a fallback', async () => {
    const showSaveFilePicker = jasmine
      .createSpy('showSaveFilePicker')
      .and.rejectWith(new DOMException('cancelled', 'AbortError'));
    const restore = withSaveFilePicker(showSaveFilePicker);
    const clicked = spyOn(HTMLAnchorElement.prototype, 'click');

    try {
      await expectAsync(saveImageFile(blob, 'trip.png')).toBeResolved();
      expect(clicked).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
