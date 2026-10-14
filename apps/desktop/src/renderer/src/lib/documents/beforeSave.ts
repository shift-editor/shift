/** Work that must finish before the document is saved, such as applying waiting edits. */
type BeforeSave = () => Promise<void>;

// non-reactive: read only when a save runs
const handlers = new Set<BeforeSave>();

/** Runs `handler` before every save; returns a function that stops it. */
export function registerBeforeSave(handler: BeforeSave): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** Runs every registered handler, in registration order. */
export async function runBeforeSave(): Promise<void> {
  for (const handler of handlers) await handler();
}
