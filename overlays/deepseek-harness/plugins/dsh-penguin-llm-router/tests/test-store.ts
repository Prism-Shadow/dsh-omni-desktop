/**
 * Test seam: a minimal snapshot store matching the createSnapshotStore
 * surface the plugin consumes, so tests never import the official client
 * runtime bundle (which needs the harness module loader). The draft is
 * mutated in place like the real immer-backed store.
 */

export interface TestSnapshotStore<T> {
  getSnapshot(): T
  update(mutator: (draft: T) => void): void
}

export function createTestSnapshotStore<T>(initial: T): TestSnapshotStore<T> {
  let state = structuredClone(initial) as T
  return {
    getSnapshot: () => state,
    update: (mutator) => {
      mutator(state)
      state = { ...state }
    },
  }
}
