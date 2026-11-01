import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Merges class names, knowing the app's own text sizes (index.css `--text-*`)
 * so a size such as `text-label` is not mistaken for a color and made to
 * drop `text-on-accent`.
 */
const mergeClassNames = extendTailwindMerge({
  extend: {
    theme: {
      text: ["ui", "label", "heading", "body"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return mergeClassNames(clsx(inputs));
}
