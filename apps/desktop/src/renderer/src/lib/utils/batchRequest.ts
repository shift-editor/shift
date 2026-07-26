/**
 * Creates a keyed request function that batches same-turn work and shares in-flight work.
 *
 * Resolved requests are forgotten. The caller remains responsible for retaining loaded values
 * and excluding keys that are already resident.
 */
export function createBatchRequest<Key>(
  loadBatch: (keys: readonly Key[]) => Promise<void>,
): (keys: readonly Key[]) => Promise<void> {
  const inFlight = new Map<Key, Promise<void>>();
  let batchScheduled = false;
  let scheduledKeys = new Set<Key>();
  let scheduledRequest = Promise.resolve();

  async function runBatch(keys: ReadonlySet<Key>): Promise<void> {
    await Promise.resolve();
    batchScheduled = false;

    try {
      await loadBatch([...keys]);
    } finally {
      for (const key of keys) inFlight.delete(key);
    }
  }

  function requestKey(key: Key): Promise<void> {
    const existing = inFlight.get(key);
    if (existing) return existing;

    if (!batchScheduled) {
      batchScheduled = true;
      scheduledKeys = new Set<Key>();
      scheduledRequest = runBatch(scheduledKeys);
    }

    scheduledKeys.add(key);
    inFlight.set(key, scheduledRequest);
    return scheduledRequest;
  }

  return async (keys) => {
    const requests = [...new Set(keys)].map(requestKey);
    await Promise.all(requests);
  };
}
