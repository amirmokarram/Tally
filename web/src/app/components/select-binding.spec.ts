/**
 * Every `<select>` whose options come from `@for` must show the value the model
 * actually holds.
 *
 * Binding `[value]` on the select itself looks right and compiles, but the
 * assignment runs before `@for` has created the options — it matches nothing,
 * and the control silently falls back to displaying the first option. The model
 * stays correct, so nothing breaks except what the user is looking at, which is
 * exactly the kind of bug that survives a long time. The fix is `[selected]` on
 * each option; these tests hold that in place.
 *
 * The currency controls used to be selects too; they are now the searchable
 * picker, and the same "shows what the model holds" guarantee is tested in
 * `currency-picker.spec.ts`.
 */

import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { App } from '../app';
import { routes } from '../app.routes';
import { TripStore } from '../core/trip-store';
import { SESSION_STORAGE, TRIP_STORAGE } from '../core/library-storage';
import { FakeStorage } from '../core/library-storage.spec';

function configure() {
  TestBed.configureTestingModule({
    imports: [App],
    providers: [
      { provide: TRIP_STORAGE, useValue: new FakeStorage() },
      { provide: SESSION_STORAGE, useValue: new FakeStorage() },
      provideRouter(routes),
    ],
  });
}

describe('select bindings', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows the sort order the list is actually using', async () => {
    configure();
    const fixture = TestBed.createComponent(App);
    const store = TestBed.inject(TripStore);

    // The sort control only appears once there is more than one split.
    store.createSplit();
    await TestBed.inject(Router).navigateByUrl('/splits');
    fixture.detectChanges();

    const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      'app-splits-panel .sort select',
    )!;
    expect(select.value).toBe('recent');

    select.value = 'total';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(select.value).toBe('total');
  });
});
