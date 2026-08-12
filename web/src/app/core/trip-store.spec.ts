/**
 * Undo/redo history.
 *
 * Each test drives a real `TripStore` directly through its public mutators —
 * these are exactly the calls a component makes, so exercising them here
 * proves the history logic without needing the grid or any UI at all.
 */

import { TestBed } from '@angular/core/testing';

import { TripStore } from './trip-store';
import { APP_MARKER, SCHEMA_VERSION, SESSION_STORAGE, STORAGE_KEY, TRIP_STORAGE } from './library-storage';
import { FakeStorage } from './library-storage.spec';
import { SavedSplit } from '../models/library.model';

function store(): TripStore {
  TestBed.configureTestingModule({
    providers: [
      { provide: TRIP_STORAGE, useValue: new FakeStorage() },
      { provide: SESSION_STORAGE, useValue: new FakeStorage() },
    ],
  });
  return TestBed.inject(TripStore);
}

describe('TripStore undo/redo', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('starts with nothing to undo or redo', () => {
    const s = store();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
  });

  it('undoes and redoes a single mutation', () => {
    const s = store();
    s.addPerson('Ana');
    expect(s.canUndo()).toBe(true);

    s.undo();
    expect(s.people().length).toBe(0);
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(true);

    s.redo();
    expect(s.people().map((p) => p.name)).toEqual(['Ana']);
    expect(s.canRedo()).toBe(false);
  });

  it('steps back through several independent edits one at a time', () => {
    const s = store();
    const sheet = s.sheets()[0];
    s.addPerson('Ana');
    s.addPerson('Bo');
    s.renameSheet(sheet.id, 'Dinner');

    s.undo();
    expect(s.sheets()[0].name).not.toBe('Dinner');
    expect(s.people().map((p) => p.name)).toEqual(['Ana', 'Bo']);

    s.undo();
    expect(s.people().map((p) => p.name)).toEqual(['Ana']);

    s.undo();
    expect(s.people().length).toBe(0);
    expect(s.canUndo()).toBe(false);
  });

  it('a fresh edit after an undo clears the redo stack', () => {
    const s = store();
    s.addPerson('Ana');
    s.undo();
    expect(s.canRedo()).toBe(true);

    s.addPerson('Bo');
    expect(s.canRedo()).toBe(false);
    expect(s.people().map((p) => p.name)).toEqual(['Bo']);
  });

  it('undo/redo on an empty stack is a no-op', () => {
    const s = store();
    expect(() => s.undo()).not.toThrow();
    expect(() => s.redo()).not.toThrow();
    expect(s.people().length).toBe(0);
  });

  describe('coalescing keystroke-driven edits', () => {
    it('merges consecutive edits to the same field into one undo step', () => {
      const s = store();
      const person = s.addPerson('');
      expect(s.canUndo()).toBe(true);

      // Simulates typing "Ana" one keystroke at a time.
      s.renamePerson(person.id, 'A');
      s.renamePerson(person.id, 'An');
      s.renamePerson(person.id, 'Ana');
      expect(s.people()[0].name).toBe('Ana');

      s.undo();
      // Back past the whole rename run, to right after the person was added.
      expect(s.people()[0].name).toBe('');

      s.undo();
      expect(s.people().length).toBe(0);
      expect(s.canUndo()).toBe(false);
    });

    it('does not merge edits to a different field', () => {
      const s = store();
      const ana = s.addPerson('');
      const bo = s.addPerson('');

      s.renamePerson(ana.id, 'Ana');
      s.renamePerson(bo.id, 'Bo');

      s.undo();
      expect(s.people().map((p) => p.name)).toEqual(['Ana', '']);

      s.undo();
      expect(s.people().map((p) => p.name)).toEqual(['', '']);
    });

    it('flushes a pending coalesce once the idle window elapses', () => {
      jasmine.clock().install();
      try {
        const s = store();
        const person = s.addPerson('');

        s.renamePerson(person.id, 'A');
        jasmine.clock().tick(2000);
        s.renamePerson(person.id, 'B');

        s.undo();
        // The second run undoes on its own, leaving the first run's edit.
        expect(s.people()[0].name).toBe('A');

        s.undo();
        expect(s.people()[0].name).toBe('');
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('flushes a pending coalesce before undo/redo act', () => {
      const s = store();
      const person = s.addPerson('');
      s.renamePerson(person.id, 'A');
      s.renamePerson(person.id, 'Ana');

      // No idle wait at all — undo must still capture the whole run.
      s.undo();
      expect(s.people()[0].name).toBe('');
    });
  });

  describe('transactions', () => {
    it('collapses several mutator calls into one undo step', () => {
      const s = store();
      s.transaction(() => {
        s.addPerson('Ana');
        s.addPerson('Bo');
        s.addPerson('Cy');
      });
      expect(s.people().length).toBe(3);

      s.undo();
      expect(s.people().length).toBe(0);
      expect(s.canUndo()).toBe(false);
    });

    it('nested transactions still yield a single undo step', () => {
      const s = store();
      s.transaction(() => {
        s.addPerson('Ana');
        s.transaction(() => {
          s.addPerson('Bo');
        });
        s.addPerson('Cy');
      });
      expect(s.people().length).toBe(3);

      s.undo();
      expect(s.people().length).toBe(0);
      expect(s.canUndo()).toBe(false);
    });

    it('pushes no history entry when nothing actually changed', () => {
      const s = store();
      s.transaction(() => {
        // No ticked lines to remove — the loop body never runs.
      });
      expect(s.canUndo()).toBe(false);
    });

    it('flushes a pending coalesce before starting', () => {
      const s = store();
      const person = s.addPerson('');
      s.renamePerson(person.id, 'Ana');

      s.transaction(() => {
        s.addPerson('Bo');
      });
      expect(s.people().length).toBe(2);

      s.undo();
      expect(s.people().map((p) => p.name)).toEqual(['Ana']);

      s.undo();
      expect(s.people().map((p) => p.name)).toEqual(['']);
    });
  });

  describe('clearing on split switches', () => {
    it('clears history when opening a different split', () => {
      const s = store();
      const first = s.activeSplitId();
      s.addPerson('Ana');
      expect(s.canUndo()).toBe(true);

      const other = s.createSplit();
      expect(s.canUndo()).toBe(false);

      s.openSplit(first);
      expect(s.canUndo()).withContext('switching back does not restore old history').toBe(false);
      expect(s.people().map((p) => p.name)).toEqual(['Ana']);

      s.openSplit(other.id);
      expect(s.canUndo()).toBe(false);
    });

    it('does not clear history when opening the split already active', () => {
      const s = store();
      s.addPerson('Ana');
      s.openSplit(s.activeSplitId());
      expect(s.canUndo()).toBe(true);
    });

    it('clears history when duplicating (switches to the copy)', () => {
      const s = store();
      s.addPerson('Ana');
      s.duplicateSplit(s.activeSplitId());
      expect(s.canUndo()).toBe(false);
    });

    it('clears history when the active split is deleted', () => {
      const s = store();
      const first = s.activeSplitId();
      s.createSplit();
      s.addPerson('Ana');
      expect(s.canUndo()).toBe(true);

      s.deleteSplit(s.activeSplitId());
      expect(s.canUndo()).toBe(false);
      expect(s.activeSplitId()).toBe(first);
    });

    it('does not clear history when a different split is deleted', () => {
      const s = store();
      const keeper = s.activeSplitId();
      const doomed = s.createSplit(); // switches active to the new split
      s.openSplit(keeper); // back to the original, which still has no history
      s.addPerson('Ana');
      expect(s.canUndo()).toBe(true);

      s.deleteSplit(doomed.id); // not the active split
      expect(s.canUndo()).toBe(true);
    });

    it('clears history on reset()', () => {
      const s = store();
      s.addPerson('Ana');
      s.reset();
      expect(s.canUndo()).toBe(false);
    });

    it('clears history on loadSample()', () => {
      const s = store();
      s.addPerson('Ana');
      s.loadSample('camping');
      expect(s.canUndo()).toBe(false);
    });
  });

  describe('clearing on a remote change from another tab', () => {
    function documentFor(splits: readonly SavedSplit[]): string {
      return JSON.stringify({
        app: APP_MARKER,
        version: SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        splits,
      });
    }

    it('clears history once another tab’s write is adopted', () => {
      const s = store();
      s.addPerson('Ana');
      expect(s.canUndo()).toBe(true);

      const mine = s.splitById(s.activeSplitId())!;
      const remoteVersion: SavedSplit = { ...mine, trip: { ...mine.trip, people: [] } };

      // Simulates the `storage` event a background tab's write raises —
      // outside the active-edit window so it is adopted immediately, rather
      // than queued as a conflict.
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(Date.now() + 60_000));
      try {
        window.dispatchEvent(
          new StorageEvent('storage', { key: STORAGE_KEY, newValue: documentFor([remoteVersion]) }),
        );
      } finally {
        jasmine.clock().uninstall();
      }

      expect(s.canUndo()).toBe(false);
    });
  });
});
