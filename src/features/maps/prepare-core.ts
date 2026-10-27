// The work a downloaded map or routing pack still has to do before it is ready, as plain state:
// tasks per item (its search index from the tiles, each side file's import, emergency points from
// Overpass), each with a weight (bytes, or bytes-equivalent) and how much of it is done.
// An item's tasks stay, finished ones included, until all of them are done: its progress never
// goes back while a later task is still running. prepare.ts keeps it in a store.
// Pure (no `@/` aliases): prepare-core.test.ts.

export type Task = { weight: number; done: number };

/** Tasks per item id, by task key. */
export type Preparing = Record<string, Record<string, Task>>;

export function beginTask(state: Preparing, itemId: string, key: string, weight: number): Preparing {
  return { ...state, [itemId]: { ...state[itemId], [key]: { weight: Math.max(1, weight), done: 0 } } };
}

/** `done`: 0..1. Unchanged state (same object) when the task is gone or moved less than 1 %. */
export function updateTask(state: Preparing, itemId: string, key: string, done: number): Preparing {
  const task = state[itemId]?.[key];
  const value = Math.min(1, Math.max(0, done));
  if (!task || Math.floor(value * 100) === Math.floor(task.done * 100)) return state;
  return { ...state, [itemId]: { ...state[itemId], [key]: { ...task, done: value } } };
}

/** The task is done; once every task of the item is, the item is dropped. */
export function endTask(state: Preparing, itemId: string, key: string): Preparing {
  const tasks = state[itemId];
  if (!tasks?.[key]) return state;
  const next = { ...tasks, [key]: { ...tasks[key], done: 1 } };
  if (Object.values(next).every((t) => t.done >= 1)) {
    const rest = { ...state };
    delete rest[itemId];
    return rest;
  }
  return { ...state, [itemId]: next };
}

/** How much of these items' work is done (0..1), or null when none of them has any left. */
export function preparedFraction(state: Preparing, itemIds: string[]): number | null {
  const tasks = itemIds.flatMap((id) => Object.values(state[id] ?? {}));
  if (!tasks.length) return null;
  const total = tasks.reduce((sum, t) => sum + t.weight, 0);
  return tasks.reduce((sum, t) => sum + t.weight * t.done, 0) / total;
}
