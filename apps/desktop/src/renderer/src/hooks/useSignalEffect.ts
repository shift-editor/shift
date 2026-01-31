import { useEffect } from "react";
import { effect } from "@/lib/reactive";

export function useSignalEffect(fn: () => void) {
  useEffect(() => {
    const fx = effect(fn);
    return () => fx.dispose();
  }, []);
}
