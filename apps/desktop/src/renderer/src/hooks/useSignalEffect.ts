import { useEffect } from "react";
import { effect } from "@shift/editor/signals";

export function useSignalEffect(fn: () => void) {
  useEffect(() => {
    const fx = effect(fn);
    return () => fx.dispose();
  }, []);
}
