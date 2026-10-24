import { useCallback, useMemo, useState } from "react";

/**
 * `set` with each of `items` added (`member` true) or removed (false).
 *
 * @returns `set` itself when nothing changes, so React skips the re-render.
 */
export function withMembership<T>(
  set: ReadonlySet<T>,
  items: Iterable<T>,
  member: boolean,
): ReadonlySet<T> {
  const toChange = Iterator.from(items)
    .filter((item) => set.has(item) !== member)
    .toArray();
  if (toChange.length === 0) return set;

  return member ? set.union(new Set(toChange)) : set.difference(new Set(toChange));
}

/**
 * A set held in React state, changed by membership rather than by copying it
 * at each call site.
 *
 * @param initial - The members on first render.
 * @returns the current members and stable functions that change them.
 */
export function useMemberSet<T>(initial: Iterable<T> = []) {
  const [values, setValues] = useState<ReadonlySet<T>>(() => new Set(initial));

  const set = useCallback((item: T, member: boolean) => {
    setValues((previous) => withMembership(previous, [item], member));
  }, []);
  const setMany = useCallback((items: Iterable<T>, member: boolean) => {
    setValues((previous) => withMembership(previous, items, member));
  }, []);
  const clear = useCallback(() => {
    setValues((previous) => (previous.size === 0 ? previous : new Set()));
  }, []);
  const has = useCallback((item: T) => values.has(item), [values]);

  return useMemo(() => ({ values, has, set, setMany, clear }), [values, has, set, setMany, clear]);
}
