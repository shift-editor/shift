/*
 * Adapted from use-sync-external-store, Copyright Meta Platforms, Inc.
 * Licensed under the MIT License.
 */
import { useDebugValue, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

interface SelectionInstance<Selection> {
  hasValue: boolean;
  value: Selection | null;
}

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: (() => Snapshot) | undefined,
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (left: Selection, right: Selection) => boolean,
): Selection {
  const instanceRef = useRef<SelectionInstance<Selection> | null>(null);
  const instance = instanceRef.current ?? { hasValue: false, value: null };
  instanceRef.current = instance;

  const [getSelection, getServerSelection] = useMemo(() => {
    let hasMemo = false;
    let memoizedSnapshot: Snapshot;
    let memoizedSelection: Selection;

    const memoizedSelector = (nextSnapshot: Snapshot): Selection => {
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        const nextSelection = selector(nextSnapshot);
        if (isEqual && instance.hasValue && isEqual(instance.value as Selection, nextSelection)) {
          memoizedSelection = instance.value as Selection;
          return memoizedSelection;
        }
        memoizedSelection = nextSelection;
        return nextSelection;
      }

      if (Object.is(memoizedSnapshot, nextSnapshot)) return memoizedSelection;

      const nextSelection = selector(nextSnapshot);
      if (isEqual && isEqual(memoizedSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot;
        return memoizedSelection;
      }

      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;
      return nextSelection;
    };

    return [
      () => memoizedSelector(getSnapshot()),
      getServerSnapshot ? () => memoizedSelector(getServerSnapshot()) : undefined,
    ] as const;
  }, [getSnapshot, getServerSnapshot, selector, isEqual, instance]);

  const value = useSyncExternalStore(subscribe, getSelection, getServerSelection);
  useEffect(() => {
    instance.hasValue = true;
    instance.value = value;
  }, [instance, value]);
  useDebugValue(value);
  return value;
}
