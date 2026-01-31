import { useRef } from "react";
import { useSignalEffect } from "./useSignalEffect";

export function useSignalText<T>(
  getValue: () => T,
  format?: (value: T) => string,
): React.RefObject<HTMLElement | null> {
  const ref = useRef<HTMLElement>(null);

  useSignalEffect(() => {
    const value = getValue();
    if (ref.current) {
      ref.current.textContent = format ? format(value) : String(value);
    }
  });

  return ref;
}
