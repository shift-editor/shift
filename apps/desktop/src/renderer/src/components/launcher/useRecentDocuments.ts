import { useEffect, useState } from "react";
import type { RecentDocument } from "@shared/recents";
import { getShiftHost } from "@/host/shiftHost";

const CLOCK_TICK_MS = 60_000;

/**
 * Subscribes to main's recent files.
 *
 * @remarks
 * Refetches when the window regains focus so files moved or deleted while the
 * launcher sat in the background show as missing.
 *
 * @returns recent files newest first, or null until the first list arrives.
 */
export function useRecentDocuments(): RecentDocument[] | null {
  const [documents, setDocuments] = useState<RecentDocument[] | null>(null);

  useEffect(() => {
    const host = getShiftHost();
    let active = true;

    const refresh = async () => {
      try {
        const listed = await host.recents.list();
        if (active) setDocuments(listed);
      } catch (error) {
        console.error("listing recent files failed", error);
      }
    };

    void refresh();
    const unsubscribe = host.recents.onChanged(setDocuments);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return documents;
}

/** Returns the current time, advancing once a minute so relative labels stay fresh. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return now;
}

/**
 * Tracks whether Alt (Option) is held, resetting when the window loses focus
 * so a key released elsewhere cannot leave it stuck on.
 */
export function useAltKeyHeld(): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const update = (event: KeyboardEvent) => setHeld(event.altKey);
    const release = () => setHeld(false);
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("blur", release);
    };
  }, []);

  return held;
}
