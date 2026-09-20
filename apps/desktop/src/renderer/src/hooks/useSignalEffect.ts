import { useEffect } from "react";
import { effect } from "@shift/editor/lib/signals/index";

export function useSignalEffect(fn: () => void) {
  useEffect(() => {
    const fx = effect(fn);
    return () => fx.dispose();
  }, []);
}
