import { CanActivateFn, Router, Routes } from '@angular/router';
import { inject } from '@angular/core';

import { TripStore } from './core/trip-store';
import { SplitsPanel } from './components/splits-panel';
import { SplitGrid } from './components/split-grid';
import { HelpPanel } from './components/help-panel';

/**
 * A returning user with data in progress wants the grid, not the guide; a
 * first-time user wants the opposite. Only the empty path needs this — once
 * a tab has its own URL, reloading or bookmarking it should return to that
 * tab, not back through this guess.
 */
const redirectToDefaultTab: CanActivateFn = () => {
  const store = inject(TripStore);
  const router = inject(Router);
  const target = store.restoredFromStorage && store.people().length ? 'split' : 'help';
  return router.parseUrl(target);
};

export const routes: Routes = [
  { path: 'splits', component: SplitsPanel },
  { path: 'split', component: SplitGrid },
  { path: 'help', component: HelpPanel },
  { path: '', pathMatch: 'full', canActivate: [redirectToDefaultTab], children: [] },
  { path: '**', redirectTo: 'help' },
];
