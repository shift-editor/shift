import { useSyncExternalStore } from "react";
import { effect, type Signal } from "./signal";

interface UseSignalOptions {
  readonly schedule?: "frame";
}

function scheduleFrame(execute: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(execute);
    return;
  }

  setTimeout(execute, 0);
}

/**
 * React hook to subscribe to a signal's value.
 *
 * Bridges the signal system to React by using useSyncExternalStore
 * with proper subscriptions (no polling).
 *
 * @example
 * const editor = getEditor();
 * const activeTool = useSignalState(editor.activeTool);
 */
export function useSignalState<T>(
  signal: Signal<T>,
  options?: UseSignalOptions,
): T {
  return useSyncExternalStore(
    (callback) => {
      const fx = effect(
        () => {
          signal.value; // Track dependency
          callback();
        },
        options?.schedule === "frame" ? { schedule: scheduleFrame } : undefined,
      );
      return () => fx.dispose();
    },
    () => signal.peek(),
  );
}

/**
 * Subscribe to a signal purely for re-render side effects — returns nothing.
 * Use when the component needs to re-render when a signal fires but doesn't
 * need the value (e.g. subscribing to a coarse "something changed" signal
 * while pulling derived values on demand elsewhere).
 *
 * Pass `null` to opt out of subscription — safe to call conditionally.
 */
export function useSignalTrigger(
  signal: Signal<unknown> | null | undefined,
  options?: UseSignalOptions,
): void {
  useSyncExternalStore(
    (callback) => {
      if (!signal) return () => {};
      const fx = effect(
        () => {
          signal.value;
          callback();
        },
        options?.schedule === "frame" ? { schedule: scheduleFrame } : undefined,
      );
      return () => fx.dispose();
    },
    () => (signal ? signal.peek() : null),
  );
}
