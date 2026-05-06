import { useEffect } from "react";
import { effect } from "@/lib/signals";

export function useSignalEffect(fn: () => void) {
  useEffect(() => {
    const fx = effect(fn);
    return () => fx.dispose();
  }, []);
}
