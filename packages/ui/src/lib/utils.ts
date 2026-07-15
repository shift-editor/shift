import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const mergeClassNames = extendTailwindMerge({
  extend: {
    theme: {
      text: ["ui"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return mergeClassNames(clsx(inputs));
}
