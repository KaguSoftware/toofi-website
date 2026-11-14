import type { BlockChange } from "@/lib/content/schemas";

export const changeId = (scope: string, key: string) => `${scope}:${key}`;

/**
 * Pending (unsaved) block changes, keyed by `scope:key`.
 *
 * A tiny external store instead of React state so that typing in one block never
 * re-renders the page — only subscribers (the toolbar) update.
 */
export class ChangeStore {
  private changes = new Map<string, BlockChange>();
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Snapshot for useSyncExternalStore (number of pending changes). */
  getSize = () => this.changes.size;
  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  set(change: BlockChange) {
    this.changes.set(changeId(change.scope, change.key), change);
    this.emit();
  }

  has(scope: string, key: string) {
    return this.changes.has(changeId(scope, key));
  }

  delete(scope: string, key: string) {
    if (this.changes.delete(changeId(scope, key))) this.emit();
  }

  clear() {
    if (this.changes.size === 0) return;
    this.changes.clear();
    this.emit();
  }

  /** Entries as they are right now (pass back to `settle` after a successful save). */
  snapshot(): Array<[string, BlockChange]> {
    return [...this.changes.entries()];
  }

  /** Remove entries that were saved, unless they were edited again while saving. */
  settle(saved: Array<[string, BlockChange]>) {
    let changed = false;
    for (const [id, change] of saved) {
      if (this.changes.get(id) === change) {
        this.changes.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }
}
