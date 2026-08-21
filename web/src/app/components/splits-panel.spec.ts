/**
 * The library card's own responsive break.
 *
 * `li` was a fixed two-column CSS Grid — text on the left, the
 * Open/Export/Duplicate/Delete row pinned to a fixed-width column on the
 * right. Below the width where both fit, the *text* column was what gave
 * way: the title wrapped mid-phrase and the meta line broke onto one item
 * per row, while the actions column held its width. The fix drops the
 * actions to a row of their own instead, via a container query on the list
 * (`ul { container-type: inline-size }`) so the card responds to its own
 * width rather than the viewport's — same reasoning as the toolbar's own
 * container query in `split-grid.ts`.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TripStore } from '../core/trip-store';
import { SESSION_STORAGE, TRIP_STORAGE } from '../core/library-storage';
import { FakeStorage } from '../core/library-storage.spec';
import { SplitsPanel } from './splits-panel';

function panel(): { fixture: ComponentFixture<SplitsPanel>; store: TripStore } {
  TestBed.configureTestingModule({
    imports: [SplitsPanel],
    providers: [
      { provide: TRIP_STORAGE, useValue: new FakeStorage() },
      { provide: SESSION_STORAGE, useValue: new FakeStorage() },
      provideRouter([]),
    ],
  });

  const store = TestBed.inject(TripStore);
  const fixture = TestBed.createComponent(SplitsPanel);
  // Real layout — including the container query under test — only resolves
  // once the fixture is actually part of the rendered document.
  document.body.appendChild(fixture.nativeElement);
  return { fixture, store };
}

async function settle(fixture: ComponentFixture<SplitsPanel>): Promise<void> {
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

/** A split with a real title, five people and 21 items — long enough to
 *  actually contend with the actions column for room. */
function loadWideSplit(store: TripStore): void {
  store.loadSample('new-england');
}

describe('splits panel', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelectorAll('app-splits-panel').forEach((el) => el.remove());
  });

  describe('card layout', () => {
    it('keeps the actions column beside the text once there is room for both', async () => {
      const { fixture, store } = panel();
      loadWideSplit(store);
      (fixture.nativeElement as HTMLElement).style.width = '900px';
      await settle(fixture);

      const li = (fixture.nativeElement as HTMLElement).querySelector('li')!;
      const title = li.querySelector('.title')!.getBoundingClientRect();
      const meta = li.querySelector('.meta')!.getBoundingClientRect();
      const actions = li.querySelector('.row-actions')!.getBoundingClientRect();

      expect(getComputedStyle(li).gridTemplateColumns.trim().split(' ').length).toBe(2);
      // Same row: the actions column overlaps the text block vertically —
      // `align-items: center` gives the shorter one a top offset of its own,
      // so this checks for the same row rather than an identical `top`.
      expect(actions.top).toBeLessThan(meta.bottom);
    });

    it('drops the actions to their own row once the card runs out of room', async () => {
      const { fixture, store } = panel();
      loadWideSplit(store);
      (fixture.nativeElement as HTMLElement).style.width = '500px';
      await settle(fixture);

      const li = (fixture.nativeElement as HTMLElement).querySelector('li')!;
      const title = li.querySelector('.title')!.getBoundingClientRect();
      const meta = li.querySelector('.meta')!.getBoundingClientRect();
      const actions = li.querySelector('.row-actions')!.getBoundingClientRect();

      expect(getComputedStyle(li).gridTemplateColumns.trim().split(' ').length).toBe(1);
      // The actions row is now below the text, not squeezed beside it.
      expect(actions.top).toBeGreaterThanOrEqual(meta.bottom);
      // The text gets the card's full width, not a shrunk shared column —
      // this is what keeps the title and meta line from wrapping word by word.
      expect(title.left).toBe(actions.left);
      expect(Math.round(title.width)).toBe(Math.round(actions.width));
    });
  });
});
