/**
 * The trip store.
 *
 * One signal holds the whole library of saved splits; the trip being edited is
 * a `computed` projection of the active one, and every derived number is a
 * further `computed` that re-runs the pure engine. That mirrors the
 * spreadsheet's model — you edit inputs, formulas recalculate — and keeps all
 * business logic outside Angular.
 *
 * Because the mutators all funnel through {@link TripStore.update}, which
 * rewrites only the active split, they are unaware the library exists.
 *
 * The library is restored from browser storage on start-up and written back on
 * every change. Which split is *active* is per-tab rather than shared, so two
 * tabs can sit on different splits without fighting. See `library-storage.ts`
 * for the format and its validation.
 */

import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';

import {
  Charge,
  DEFAULT_CURRENCY,
  ExpenseItem,
  ExpenseSheet,
  Person,
  Share,
  Trip,
  amountCharge,
} from '../models/trip.model';
import { CURRENCIES, Currency } from '../data/currencies';
import {
  PersonBalance,
  SplitResult,
  autoRate,
  computeSplit,
  isRatePinned,
  round,
  sheetRate,
} from './split-engine';
import { Transfer, assignTransactionGroups, buildTransfers } from './settlement';
import { Issue, sheetIssues, tripIssues } from './validation';
import { SAMPLE_TRIPS, SampleTripId, buildSampleTrip } from '../data/sample-trips';
import {
  SavedSplit,
  mostRecentFirst,
  newSavedSplit,
  nextUpdatedAt,
} from '../models/library.model';
import {
  ACTIVE_SPLIT_KEY,
  PRE_RENAME_ACTIVE_SPLIT_KEY,
  SESSION_STORAGE,
  STORAGE_KEY,
  TRIP_STORAGE,
  loadLibrary,
  parseDocument,
  saveLibrary,
  serializeLibrary,
  serializeTrip,
} from './library-storage';

let sequence = 0;

/**
 * Ids only have to be unique within a trip, but they now outlive the page, so
 * the random suffix matters: a counter alone would restart at zero after a
 * reload and collide with the ids already in storage.
 */
export function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}_${sequence.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptySheet(name: string): ExpenseSheet {
  return {
    id: nextId('sheet'),
    name,
    currency: DEFAULT_CURRENCY,
    rateOverride: null,
    paidBy: [],
    tax: amountCharge(0),
    tip: amountCharge(0),
    discount: amountCharge(0),
    items: [],
  };
}

export function emptyTrip(): Trip {
  return {
    title: 'New Split',
    baseCurrency: 'USD',
    people: [],
    sheets: [emptySheet('Expenses')],
    shares: {},
  };
}

@Injectable({ providedIn: 'root' })
export class TripStore {
  private readonly storage = inject(TRIP_STORAGE);
  private readonly session = inject(SESSION_STORAGE);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Every saved split. Never empty — {@link deleteSplit} replaces the last one
   * with a fresh split rather than leaving nothing, which keeps
   * {@link activeSplit} total and every downstream `computed` free of null
   * handling.
   */
  private readonly libraryState = signal<SavedSplit[]>([]);

  /** Which split this *tab* is showing. Deliberately not shared between tabs. */
  private readonly activeIdState = signal<string>('');

  /**
   * Undo/redo history for the split being edited. Deliberately in-memory
   * only — not part of `libraryState`, never written to storage — since it
   * is session-scoped editing state, not data that travels with the split.
   * See {@link clearHistory} for when it resets.
   */
  private readonly undoStackState = signal<Trip[]>([]);
  private readonly redoStackState = signal<Trip[]>([]);
  readonly canUndo = computed(() => this.undoStackState().length > 0);
  readonly canRedo = computed(() => this.redoStackState().length > 0);

  private static readonly HISTORY_LIMIT = 200;

  /** How long a run of same-field keystrokes (a rename, a charge box) stays one undo step. */
  private static readonly COALESCE_IDLE_MS = 1000;

  private transactionDepth = 0;
  private pendingCoalesce: { key: string; before: Trip } | null = null;
  private coalesceTimer: ReturnType<typeof setTimeout> | null = null;

  /** The library, most recently edited first. */
  readonly splits = computed(() => mostRecentFirst(this.libraryState()));

  readonly activeSplitId = this.activeIdState.asReadonly();

  private readonly activeSplit = computed<SavedSplit>(() => {
    const all = this.libraryState();
    return all.find((split) => split.id === this.activeIdState()) ?? all[0];
  });

  private readonly state = computed<Trip>(() => this.activeSplit().trip);

  /** The current trip. Treat as read-only; mutate through the methods below. */
  readonly trip = this.state;

  /** False when the browser gives us nowhere to save — private mode, mainly. */
  readonly persistenceAvailable = this.storage !== null;

  /** True when a saved library was found at start-up, rather than a fresh one. */
  readonly restoredFromStorage: boolean;

  private readonly saveFailedSignal = signal(false);

  /** Set when a write was rejected, e.g. the storage quota is full. */
  readonly saveFailed = this.saveFailedSignal.asReadonly();

  /**
   * A change from another tab that this tab has not applied, because the user
   * was mid-edit here. Null when there is nothing to resolve.
   */
  private readonly pendingRemoteSignal = signal<SavedSplit[] | null>(null);
  readonly pendingRemote = this.pendingRemoteSignal.asReadonly();

  /** Set briefly after another tab's change is adopted, so the jump is explained. */
  private readonly syncedFromOtherTabSignal = signal(false);
  readonly syncedFromOtherTab = this.syncedFromOtherTabSignal.asReadonly();

  /** Serialised form of what is currently in storage, as far as this tab knows. */
  private lastPersisted = '';

  /** When the user last changed something *in this tab*. */
  private lastLocalEditAt = 0;

  private syncNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const restored = loadLibrary(this.storage);
    this.restoredFromStorage = !!restored?.length;

    const splits = restored?.length ? restored : [newSavedSplit(emptyTrip(), nextId('split'))];
    this.libraryState.set(splits);
    this.lastPersisted = serializeLibrary(splits);

    // A tab that is reloaded should come back to the split it was showing, not
    // to whichever one another tab happens to have touched most recently.
    const remembered = this.readActiveId();
    this.activeIdState.set(
      splits.some((split) => split.id === remembered) ? remembered! : splits[0].id,
    );

    // Autosave. A library is a few kilobytes per split, so a synchronous write
    // per edit is cheaper than the bookkeeping a debounce would need — and it
    // cannot lose the last keystroke before the tab closes.
    //
    // The comparison against `lastPersisted` is what stops a change adopted
    // from another tab being written straight back: without it, two tabs would
    // bounce the same library between them forever.
    effect(() => {
      const library = this.libraryState();
      const payload = serializeLibrary(library);
      if (payload === this.lastPersisted) {
        return;
      }
      const saved = saveLibrary(this.storage, library);
      if (saved) {
        this.lastPersisted = payload;
      }
      this.saveFailedSignal.set(!saved && this.persistenceAvailable);
    });

    effect(() => this.writeActiveId(this.activeIdState()));

    this.listenForOtherTabs();

    this.destroyRef.onDestroy(() => {
      if (this.coalesceTimer !== null) {
        clearTimeout(this.coalesceTimer);
      }
    });
  }

  private readActiveId(): string | null {
    try {
      // The pre-rename key is read so a tab open across the rename keeps its
      // place; writes go to the current key, so it heals itself.
      return (
        this.session?.getItem(ACTIVE_SPLIT_KEY) ??
        this.session?.getItem(PRE_RENAME_ACTIVE_SPLIT_KEY) ??
        null
      );
    } catch {
      return null;
    }
  }

  private writeActiveId(id: string): void {
    try {
      this.session?.setItem(ACTIVE_SPLIT_KEY, id);
    } catch {
      // Losing the pointer only costs the tab its place in the library.
    }
  }

  // --- Multi-tab sync ---------------------------------------------------

  /**
   * How recently a local edit counts as "the user is working in this tab".
   *
   * Within the window, another tab's change is treated as a conflict and left
   * for the user to resolve. Outside it, the other tab has almost certainly
   * seen this tab's last change and built on top of it, so adopting is a
   * fast-forward rather than a loss.
   */
  private static readonly ACTIVE_EDIT_WINDOW_MS = 15_000;

  private static readonly SYNC_NOTICE_MS = 6_000;

  private listenForOtherTabs(): void {
    if (!this.persistenceAvailable || typeof window === 'undefined') {
      return;
    }

    const onStorage = (event: StorageEvent) => this.onRemoteChange(event);
    window.addEventListener('storage', onStorage);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('storage', onStorage);
      if (this.syncNoticeTimer !== null) {
        clearTimeout(this.syncNoticeTimer);
      }
    });
  }

  /**
   * Handles a write made by another tab.
   *
   * The `storage` event only fires in *other* tabs, never the one that wrote,
   * so anything arriving here is genuinely remote.
   */
  private onRemoteChange(event: StorageEvent): void {
    // A null key means the whole storage area was cleared. Adopting an empty
    // trip on that signal would be destructive, and this tab's next write
    // restores the data anyway, so ignore it.
    if (event.key !== STORAGE_KEY) {
      return;
    }
    // `storageArea` is absent on synthetic events; only check it when present.
    if (event.storageArea && event.storageArea !== this.storage) {
      return;
    }

    const incoming = parseDocument(event.newValue);
    if (!incoming) {
      return;
    }

    const payload = serializeLibrary(incoming);
    if (payload === serializeLibrary(this.libraryState())) {
      // Already converged — the other tab simply caught up with us.
      this.lastPersisted = payload;
      this.pendingRemoteSignal.set(null);
      return;
    }

    // Only a change to the split *this tab is showing* can disturb the user.
    // Another tab editing a different split is none of this tab's business, so
    // the library updates underneath without a word.
    const mine = this.activeSplit();
    const theirs = incoming.find((split) => split.id === mine.id);
    const activeUnchanged = !!theirs && serializeTrip(theirs.trip) === serializeTrip(mine.trip);

    if (activeUnchanged) {
      this.adoptRemote(incoming, { quiet: true });
      return;
    }

    if (Date.now() - this.lastLocalEditAt < TripStore.ACTIVE_EDIT_WINDOW_MS) {
      // The user is working here. Do not move the ground under them.
      this.pendingRemoteSignal.set(incoming);
      return;
    }

    this.adoptRemote(incoming);
  }

  /** Takes the other tab's version, discarding this tab's divergence. */
  acceptRemoteChange(): void {
    const incoming = this.pendingRemoteSignal();
    if (incoming) {
      this.adoptRemote(incoming);
    }
  }

  /** Keeps this tab's version and republishes it, so the other tabs follow. */
  keepLocalVersion(): void {
    this.pendingRemoteSignal.set(null);
    const library = this.libraryState();
    if (saveLibrary(this.storage, library)) {
      this.lastPersisted = serializeLibrary(library);
    }
  }

  private adoptRemote(splits: SavedSplit[], options: { quiet?: boolean } = {}): void {
    // Set this *first*: the autosave effect compares against it and will skip
    // writing, which is what keeps two tabs from echoing each other.
    this.lastPersisted = serializeLibrary(splits);
    this.libraryState.set(splits);
    this.pendingRemoteSignal.set(null);
    // Snapshots taken before this no longer describe a lineage that leads to
    // the live state — redoing into one could silently clobber the other
    // tab's edit.
    this.clearHistory();

    // The other tab may have deleted the split this one was showing.
    if (!splits.some((split) => split.id === this.activeIdState())) {
      this.activeIdState.set(splits[0]?.id ?? '');
    }

    if (!options.quiet) {
      this.showSyncNotice();
    }
  }

  private showSyncNotice(): void {
    this.syncedFromOtherTabSignal.set(true);
    if (this.syncNoticeTimer !== null) {
      clearTimeout(this.syncNoticeTimer);
    }
    this.syncNoticeTimer = setTimeout(() => {
      this.syncedFromOtherTabSignal.set(false);
      this.syncNoticeTimer = null;
    }, TripStore.SYNC_NOTICE_MS);
  }

  readonly title = computed(() => this.state().title);
  readonly people = computed(() => this.state().people);
  readonly sheets = computed(() => this.state().sheets);
  readonly baseCurrency = computed(() => this.state().baseCurrency);

  readonly baseCurrencyInfo = computed<Currency | undefined>(() =>
    CURRENCIES.find((c) => c.code === this.state().baseCurrency),
  );

  readonly baseSymbol = computed(() => this.baseCurrencyInfo()?.symbol ?? '');

  /** Full recalculation: rows, balances, groups, grand total. */
  readonly split = computed<SplitResult>(() => {
    const trip = this.state();
    const order = trip.people.map((p) => p.id);
    return computeSplit(trip, (balances) => assignTransactionGroups(balances, order));
  });

  readonly balances = computed<PersonBalance[]>(() => this.split().balances);

  readonly grandTotal = computed(() => this.split().grandTotal);

  /** Highest-priority trip problem, or null — the Split sheet's red message. */
  readonly issues = computed<Issue[]>(() => tripIssues(this.state(), this.split().rows));

  readonly primaryIssue = computed<Issue | null>(
    () => this.issues().find((i) => i.severity === 'error') ?? this.issues()[0] ?? null,
  );

  /** Sheet-local problems, keyed by sheet id. */
  readonly issuesBySheet = computed<Map<string, Issue[]>>(() => {
    const trip = this.state();
    const map = new Map<string, Issue[]>();
    for (const sheet of trip.sheets) {
      map.set(sheet.id, sheetIssues(sheet, trip));
    }
    for (const issue of this.issues()) {
      if (issue.sheetId) {
        map.get(issue.sheetId)?.push(issue);
      }
    }
    return map;
  });

  /** Who pays whom. Empty while any blocking issue remains. */
  readonly transfers = computed<Transfer[]>(() => {
    if (this.issues().some((i) => i.severity === 'error')) {
      return [];
    }
    const trip = this.state();
    const balances = new Map(this.balances().map((b) => [b.personId, b.balance]));
    const groups = new Map(this.balances().map((b) => [b.personId, b.group]));
    return buildTransfers(balances, groups, trip.people.map((p) => p.id));
  });

  /** Number of distinct settlement groups, 0 when everyone settles together. */
  readonly groupCount = computed(
    () => new Set(this.balances().map((b) => b.group).filter((g) => g > 0)).size,
  );

  // --- Trip-level -------------------------------------------------------

  setTitle(title: string): void {
    this.update((trip) => ({ ...trip, title }), 'trip-title');
  }

  setBaseCurrency(code: string): void {
    this.update((trip) => ({ ...trip, baseCurrency: code }));
  }

  /** Empties the split being edited, leaving the rest of the library alone. */
  reset(): void {
    this.replace(emptyTrip());
  }

  /**
   * Adds a worked example as a split of its own, rather than overwriting
   * whatever is open — the Help page is reference material, not a prompt to
   * throw away what the user was doing. Loading the same example again
   * updates that split in place instead of piling up duplicates; it is
   * recognised by title, since a sample's title is the only thing about it
   * that is fixed. Renaming it, like renaming any split, forfeits that.
   */
  loadSample(id: SampleTripId): void {
    const trip = buildSampleTrip(id);
    const existing = this.libraryState().find((split) => split.trip.title === trip.title);
    if (existing) {
      this.activeIdState.set(existing.id);
      this.replace(trip);
    } else {
      this.createSplit(trip);
    }
  }

  readonly samples = SAMPLE_TRIPS;

  // --- The library ------------------------------------------------------

  /** Adds a split and switches to it. */
  createSplit(trip: Trip = emptyTrip()): SavedSplit {
    const split = newSavedSplit(trip, nextId('split'), nextUpdatedAt(this.libraryState()));
    this.lastLocalEditAt = Date.now();
    this.libraryState.update((all) => [...all, split]);
    this.clearHistory();
    this.activeIdState.set(split.id);
    return split;
  }

  openSplit(id: string): void {
    if (id === this.activeIdState() || !this.libraryState().some((split) => split.id === id)) {
      return;
    }
    this.clearHistory();
    this.activeIdState.set(id);
  }

  /** Copies a split, ids and all — ids only need to be unique within a trip. */
  duplicateSplit(id: string): SavedSplit | null {
    const source = this.libraryState().find((split) => split.id === id);
    if (!source) {
      return null;
    }
    const copy = structuredClone(source.trip);
    copy.title = `${copy.title} (copy)`;
    return this.createSplit(copy);
  }

  /**
   * Removes a split. Deleting the last one leaves a fresh empty split rather
   * than an empty library, so there is always something to edit.
   */
  deleteSplit(id: string): void {
    this.lastLocalEditAt = Date.now();
    const remaining = this.libraryState().filter((split) => split.id !== id);

    if (remaining.length === 0) {
      const replacement = newSavedSplit(emptyTrip(), nextId('split'));
      this.libraryState.set([replacement]);
      this.clearHistory();
      this.activeIdState.set(replacement.id);
      return;
    }

    this.libraryState.set(remaining);
    if (this.activeIdState() === id) {
      // Fall through to whatever was edited most recently.
      this.clearHistory();
      this.activeIdState.set(mostRecentFirst(remaining)[0].id);
    }
  }

  /**
   * Adds splits read from a file and opens the first.
   *
   * They are *added*, never merged over what is already here, so importing can
   * never destroy an existing split. Fresh ids are assigned so that importing
   * the same file twice gives two independent copies rather than a collision.
   */
  importSplits(incoming: readonly SavedSplit[]): SavedSplit[] {
    const added = incoming.map((split) => ({ ...split, id: nextId('split') }));
    if (added.length === 0) {
      return [];
    }
    this.lastLocalEditAt = Date.now();
    this.libraryState.update((all) => [...all, ...added]);
    this.clearHistory();
    this.activeIdState.set(added[0].id);
    return added;
  }

  /** The split with this id, for the library list. */
  splitById(id: string): SavedSplit | undefined {
    return this.libraryState().find((split) => split.id === id);
  }

  /** Everything, for "export all". */
  allSplits(): SavedSplit[] {
    return mostRecentFirst(this.libraryState());
  }

  // --- People -----------------------------------------------------------

  addPerson(name = ''): Person {
    const person: Person = { id: nextId('p'), name };
    this.update((trip) => ({ ...trip, people: [...trip.people, person] }));
    return person;
  }

  renamePerson(personId: string, name: string): void {
    this.update(
      (trip) => ({
        ...trip,
        people: trip.people.map((p) => (p.id === personId ? { ...p, name } : p)),
      }),
      `person-name:${personId}`,
    );
  }

  /** Removes the person along with every share and Paid By reference to them. */
  removePerson(personId: string): void {
    this.update((trip) => {
      const shares: Trip['shares'] = {};
      for (const [itemId, byPerson] of Object.entries(trip.shares)) {
        const { [personId]: _removed, ...rest } = byPerson;
        if (Object.keys(rest).length) {
          shares[itemId] = rest;
        }
      }
      return {
        ...trip,
        people: trip.people.filter((p) => p.id !== personId),
        sheets: trip.sheets.map((s) => ({
          ...s,
          paidBy: s.paidBy.filter((id) => id !== personId),
        })),
        shares,
      };
    });
  }

  movePerson(personId: string, delta: number): void {
    this.update((trip) => ({ ...trip, people: move(trip.people, personId, delta) }));
  }

  // --- Expense sheets ---------------------------------------------------

  addSheet(name?: string): ExpenseSheet {
    const trip = this.state();
    const sheet = emptySheet(name ?? uniqueName('Expenses', trip.sheets.map((s) => s.name)));
    this.update((t) => ({ ...t, sheets: [...t.sheets, sheet] }));
    return sheet;
  }

  renameSheet(sheetId: string, name: string): void {
    this.patchSheet(sheetId, () => ({ name }), `sheet-name:${sheetId}`);
  }

  /** Removes the sheet and every share belonging to its items. */
  removeSheet(sheetId: string): void {
    this.update((trip) => {
      const sheet = trip.sheets.find((s) => s.id === sheetId);
      if (!sheet) {
        return trip;
      }
      const shares = { ...trip.shares };
      for (const item of sheet.items) {
        delete shares[item.id];
      }
      return {
        ...trip,
        sheets: trip.sheets.filter((s) => s.id !== sheetId),
        shares,
      };
    });
  }

  moveSheet(sheetId: string, delta: number): void {
    this.update((trip) => ({ ...trip, sheets: move(trip.sheets, sheetId, delta) }));
  }

  /** As {@link moveSheet}, for a whole multi-selection moved as one block. */
  moveSheets(sheetIds: ReadonlySet<string>, delta: number): void {
    this.update((trip) => ({ ...trip, sheets: moveGroup(trip.sheets, sheetIds, delta) }));
  }

  setSheetCurrency(sheetId: string, currency: string): void {
    // Switching back to the trip's base currency drops any pinned rate, the
    // same way the workbook forced C2 = 1 for default-currency sheets.
    this.patchSheet(sheetId, () => ({
      currency,
      rateOverride: currency === DEFAULT_CURRENCY ? null : undefined,
    }));
  }

  setSheetRate(sheetId: string, rate: number | null): void {
    this.patchSheet(sheetId, () => ({ rateOverride: rate }), `sheet-rate:${sheetId}`);
  }

  setSheetPayers(sheetId: string, personIds: string[]): void {
    this.patchSheet(sheetId, () => ({ paidBy: [...personIds] }));
  }

  toggleSheetPayer(sheetId: string, personId: string): void {
    this.patchSheet(sheetId, (sheet) => ({
      paidBy: sheet.paidBy.includes(personId)
        ? sheet.paidBy.filter((id) => id !== personId)
        : [...sheet.paidBy, personId],
    }));
  }

  setCharge(sheetId: string, kind: 'tax' | 'tip' | 'discount', charge: Charge): void {
    this.patchSheet(
      sheetId,
      () => ({ [kind]: charge }) as Partial<ExpenseSheet>,
      `sheet-charge:${sheetId}:${kind}`,
    );
  }

  // --- Items ------------------------------------------------------------

  addItem(sheetId: string, name = '', amount: number | null = null): ExpenseItem {
    const item: ExpenseItem = { id: nextId('i'), name, amount };
    this.patchSheet(sheetId, (sheet) => ({ items: [...sheet.items, item] }));
    return item;
  }

  /**
   * As {@link addItem}, but inserted at a position rather than always
   * appended — what a row-level Paste needs, to land right after the line
   * it targets instead of at the sheet's end. `atIndex` is clamped to the
   * sheet's own bounds, so a stale index from before an earlier paste in
   * the same batch still lands somewhere sensible.
   */
  insertItem(sheetId: string, atIndex: number, name = '', amount: number | null = null): ExpenseItem {
    const item: ExpenseItem = { id: nextId('i'), name, amount };
    this.patchSheet(sheetId, (sheet) => {
      const items = [...sheet.items];
      items.splice(Math.min(Math.max(atIndex, 0), items.length), 0, item);
      return { items };
    });
    return item;
  }

  updateItem(sheetId: string, itemId: string, patch: Partial<Omit<ExpenseItem, 'id'>>): void {
    this.patchSheet(sheetId, (sheet) => ({
      items: sheet.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
    }));
  }

  removeItem(sheetId: string, itemId: string): void {
    this.update((trip) => {
      const shares = { ...trip.shares };
      delete shares[itemId];
      return {
        ...trip,
        sheets: trip.sheets.map((s) =>
          s.id === sheetId ? { ...s, items: s.items.filter((i) => i.id !== itemId) } : s,
        ),
        shares,
      };
    });
  }

  moveItem(sheetId: string, itemId: string, delta: number): void {
    this.patchSheet(sheetId, (sheet) => ({ items: move(sheet.items, itemId, delta) }));
  }

  // --- Shares -----------------------------------------------------------

  share(itemId: string, personId: string): Share {
    return this.state().shares[itemId]?.[personId] ?? { owe: 0, pay: 0 };
  }

  setShare(itemId: string, personId: string, share: Share): void {
    this.update((trip) => {
      const row = { ...(trip.shares[itemId] ?? {}) };
      if (!share.owe && !share.pay) {
        delete row[personId];
      } else {
        row[personId] = share;
      }
      const shares = { ...trip.shares };
      if (Object.keys(row).length) {
        shares[itemId] = row;
      } else {
        delete shares[itemId];
      }
      return { ...trip, shares };
    });
  }

  /** Gives every person an equal owe share of the item — the common case. */
  splitItemEvenly(itemId: string): void {
    this.update((trip) => {
      const row: Record<string, Share> = {};
      for (const person of trip.people) {
        const existing = trip.shares[itemId]?.[person.id];
        row[person.id] = { owe: 1, pay: existing?.pay ?? 0 };
      }
      return { ...trip, shares: { ...trip.shares, [itemId]: row } };
    });
  }

  clearItemShares(itemId: string): void {
    this.update((trip) => {
      const shares = { ...trip.shares };
      delete shares[itemId];
      return { ...trip, shares };
    });
  }

  // --- Currency helpers -------------------------------------------------

  rateFor(sheet: ExpenseSheet): number {
    return sheetRate(sheet, this.state().baseCurrency);
  }

  ratePinned(sheet: ExpenseSheet): boolean {
    return isRatePinned(sheet, this.state().baseCurrency);
  }

  autoRateFor(sheet: ExpenseSheet): number | null {
    if (sheet.currency === DEFAULT_CURRENCY) {
      return 1;
    }
    return autoRate(sheet.currency, this.state().baseCurrency);
  }

  symbolFor(sheet: ExpenseSheet): string {
    if (sheet.currency === DEFAULT_CURRENCY) {
      return this.baseSymbol();
    }
    return CURRENCIES.find((c) => c.code === sheet.currency)?.symbol ?? sheet.currency;
  }

  /** Rounds to cents using the same rule as the engine, for display helpers. */
  readonly round = round;

  // --- Undo / redo --------------------------------------------------------

  /**
   * Runs `fn` as a single undo step, whatever number of individual mutator
   * calls it makes inside. Without this, a bulk action (paste, fill, remove
   * ticked lines) would need one Ctrl+Z per row touched, since every mutator
   * call is otherwise its own history entry.
   *
   * Nestable: only the outermost call captures the "before" snapshot and
   * pushes the history entry, so a transaction calling another transaction
   * still yields one undo step for the whole thing.
   */
  transaction(fn: () => void): void {
    if (this.transactionDepth === 0) {
      this.flushPendingCoalesce();
    }
    const before = this.transactionDepth === 0 ? this.activeSplit().trip : null;
    this.transactionDepth += 1;
    try {
      fn();
    } finally {
      this.transactionDepth -= 1;
      if (this.transactionDepth === 0 && before !== null) {
        const after = this.activeSplit().trip;
        if (after !== before) {
          this.pushHistory(before);
        }
      }
    }
  }

  undo(): void {
    this.flushPendingCoalesce();
    const stack = this.undoStackState();
    const prev = stack[stack.length - 1];
    if (prev === undefined) {
      return;
    }
    this.undoStackState.set(stack.slice(0, -1));
    this.redoStackState.update((redo) => [...redo, this.activeSplit().trip]);
    this.applyHistoryTrip(prev);
  }

  redo(): void {
    this.flushPendingCoalesce();
    const stack = this.redoStackState();
    const next = stack[stack.length - 1];
    if (next === undefined) {
      return;
    }
    this.redoStackState.set(stack.slice(0, -1));
    this.undoStackState.update((undo) => [...undo, this.activeSplit().trip]);
    this.applyHistoryTrip(next);
  }

  // --- Internals --------------------------------------------------------

  private patchSheet(
    sheetId: string,
    patch: (sheet: ExpenseSheet) => Partial<ExpenseSheet>,
    coalesceKey?: string,
  ): void {
    this.update(
      (trip) => ({
        ...trip,
        sheets: trip.sheets.map((sheet) => {
          if (sheet.id !== sheetId) {
            return sheet;
          }
          const changes = patch(sheet);
          // `undefined` means "leave alone", so drop those keys before merging.
          for (const key of Object.keys(changes) as (keyof ExpenseSheet)[]) {
            if (changes[key] === undefined) {
              delete changes[key];
            }
          }
          return { ...sheet, ...changes };
        }),
      }),
      coalesceKey,
    );
  }

  /**
   * The single entry point for user-driven changes to the split being edited.
   *
   * Every mutator above funnels through here, which is why none of them needs
   * to know the library exists: this is the only place that maps a change to a
   * `Trip` onto a change to the library.
   *
   * Stamping the edit time is what lets {@link onRemoteChange} tell "the user
   * is working in this tab" from "this tab has been sitting idle", which
   * decides whether another tab's change is adopted or queued as a conflict.
   *
   * `coalesceKey` is for mutators driven by `(input)` — fired on every
   * keystroke rather than once on commit, unlike a grid cell's `valueSetter`.
   * Consecutive calls with the same key merge into one undo step instead of
   * one per character; see {@link recordHistory}.
   */
  private update(fn: (trip: Trip) => Trip, coalesceKey?: string): void {
    this.recordHistory(coalesceKey);
    this.commitTrip(fn);
  }

  /** As {@link update}, for changes that replace the trip wholesale. */
  private replace(trip: Trip): void {
    this.pendingRemoteSignal.set(null);
    // A fresh/sample trip is a new starting point, not something to undo
    // back past.
    this.clearHistory();
    this.commitTrip(() => trip);
  }

  private commitTrip(fn: (trip: Trip) => Trip): void {
    this.lastLocalEditAt = Date.now();
    const activeId = this.activeSplit().id;
    const at = nextUpdatedAt(this.libraryState());
    this.libraryState.update((all) =>
      all.map((split) =>
        split.id === activeId ? { ...split, trip: fn(split.trip), updatedAt: at } : split,
      ),
    );
  }

  /** Applies an undo/redo step without itself pushing a new history entry. */
  private applyHistoryTrip(trip: Trip): void {
    this.commitTrip(() => trip);
  }

  /**
   * Decides whether this `update()` call needs a new history entry, and if
   * so captures the trip as it was *before* the mutation about to run.
   *
   * Skipped entirely inside a {@link transaction} — the transaction itself
   * owns the single snapshot for everything it does.
   */
  private recordHistory(coalesceKey?: string): void {
    if (this.transactionDepth > 0) {
      return;
    }
    if (coalesceKey && this.pendingCoalesce?.key === coalesceKey) {
      // Still the same run of edits to the same field — amend it rather than
      // pushing a new step, and give it another COALESCE_IDLE_MS to continue.
      this.resetCoalesceTimer();
      return;
    }
    this.flushPendingCoalesce();
    const before = this.activeSplit().trip;
    if (coalesceKey) {
      this.pendingCoalesce = { key: coalesceKey, before };
      this.resetCoalesceTimer();
      this.redoStackState.set([]);
    } else {
      this.pushHistory(before);
    }
  }

  private pushHistory(before: Trip): void {
    this.undoStackState.update((stack) => {
      const next = stack.length >= TripStore.HISTORY_LIMIT ? stack.slice(1) : stack;
      return [...next, before];
    });
    this.redoStackState.set([]);
  }

  private resetCoalesceTimer(): void {
    if (this.coalesceTimer !== null) {
      clearTimeout(this.coalesceTimer);
    }
    this.coalesceTimer = setTimeout(() => this.flushPendingCoalesce(), TripStore.COALESCE_IDLE_MS);
  }

  /** Commits a pending coalesced edit run as its own history entry. */
  private flushPendingCoalesce(): void {
    if (this.coalesceTimer !== null) {
      clearTimeout(this.coalesceTimer);
      this.coalesceTimer = null;
    }
    if (this.pendingCoalesce) {
      this.pushHistory(this.pendingCoalesce.before);
      this.pendingCoalesce = null;
    }
  }

  private clearHistory(): void {
    if (this.coalesceTimer !== null) {
      clearTimeout(this.coalesceTimer);
      this.coalesceTimer = null;
    }
    this.pendingCoalesce = null;
    this.undoStackState.set([]);
    this.redoStackState.set([]);
  }
}

function move<T extends { id: string }>(list: T[], id: string, delta: number): T[] {
  const from = list.findIndex((entry) => entry.id === id);
  if (from < 0) {
    return list;
  }
  const to = Math.min(list.length - 1, Math.max(0, from + delta));
  if (to === from) {
    return list;
  }
  const next = [...list];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry);
  return next;
}

/**
 * As {@link move}, for a whole set of ids moved together by one step,
 * keeping their relative order — a contiguous run of selected entries moves
 * as a block, stopping at the array's edge or at the first non-selected
 * entry in its way.
 *
 * Only single steps (`delta` of 1 or -1) are meaningful here: unlike
 * {@link move}, which jumps straight to a clamped target index, a group's
 * shape can change on every step (entries can merge into one block, or peel
 * off the edge), so a multi-step move is the repeated application of this,
 * not a single index computation.
 */
function moveGroup<T extends { id: string }>(list: T[], ids: ReadonlySet<string>, delta: number): T[] {
  if (!ids.size || (delta !== 1 && delta !== -1)) {
    return list;
  }
  const next = [...list];
  const selected = next.filter((entry) => ids.has(entry.id));
  // Ascending index order for an up-move so each entry clears the way for
  // the one behind it; descending for a down-move, symmetrically.
  const ordered = delta < 0 ? selected : [...selected].reverse();
  for (const entry of ordered) {
    const from = next.indexOf(entry);
    const to = from + delta;
    if (to < 0 || to >= next.length || ids.has(next[to].id)) {
      continue;
    }
    [next[from], next[to]] = [next[to], next[from]];
  }
  return next;
}

function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) {
    return base;
  }
  let n = 2;
  while (taken.includes(`${base} ${n}`)) {
    n += 1;
  }
  return `${base} ${n}`;
}
