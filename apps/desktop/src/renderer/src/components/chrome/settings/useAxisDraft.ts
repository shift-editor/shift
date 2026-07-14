import { useCallback, useEffect, useRef, useState } from "react";
import type { Axis } from "@shift/types";
import { useFont } from "@/workspace/WorkspaceContext";
import type { AxisDraft, AxisTransform } from "./types";

export function useAxisDraft(axis: Axis): AxisDraft {
  const font = useFont();
  const [draft, setDraft] = useState(axis);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(axis);
  const pendingRef = useRef(0);

  useEffect(() => {
    if (pendingRef.current > 0) return;

    draftRef.current = axis;
    setDraft(axis);
    setError(null);
  }, [axis]);

  const update = useCallback((transform: AxisTransform): Axis => {
    const next = transform(draftRef.current);
    draftRef.current = next;
    setDraft(next);
    return next;
  }, []);

  const commit = useCallback(
    async (candidate?: Axis): Promise<void> => {
      const next = candidate ?? draftRef.current;
      pendingRef.current += 1;
      setError(null);

      try {
        await font.updateAxis(next);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to update the axis");
      } finally {
        pendingRef.current -= 1;
      }
    },
    [font],
  );

  const updateAndCommit = useCallback(
    async (transform: AxisTransform): Promise<void> => {
      const next = update(transform);
      await commit(next);
    },
    [commit, update],
  );

  return { axis: draft, error, update, commit, updateAndCommit };
}
