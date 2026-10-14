import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** Code sizes ⌘+ and ⌘− step through, in pixels. */
const SIZES = [9, 10, 11, 12, 13, 14, 16, 18, 20, 24];
const DEFAULT_SIZE = 12;
const SIZE_KEY = "shift.featureCodeWindow.fontSize";

const zoom = new Compartment();
// non-reactive: read only when a zoom command runs
const sizes = new WeakMap<EditorView, number>();

/** The code's font size, as the last zoom left it; the window chrome keeps its size. */
export function codeZoom(): Extension {
  return zoom.of(sizeTheme(savedSize()));
}

/** Steps the code's size up (1), down (−1), or back to the default (0). */
export function zoomCode(view: EditorView, step: -1 | 0 | 1): boolean {
  const current = sizes.get(view) ?? savedSize();
  const index = SIZES.indexOf(current);
  const next =
    step === 0
      ? DEFAULT_SIZE
      : (SIZES[Math.min(SIZES.length - 1, Math.max(0, index + step))] ?? DEFAULT_SIZE);
  if (next === current && step !== 0) return true;
  sizes.set(view, next);
  view.dispatch({ effects: zoom.reconfigure(sizeTheme(next)) });
  try {
    localStorage.setItem(SIZE_KEY, String(next));
  } catch {
    // Remembering the size is a convenience; private storage may refuse it.
  }
  return true;
}

/** Line height keeps the default's 12:20 rhythm at every size. */
function sizeTheme(size: number): Extension {
  return EditorView.theme({
    "&": { fontSize: `${size}px` },
    ".cm-scroller": { lineHeight: `${Math.round((size * 5) / 3)}px` },
  });
}

function savedSize(): number {
  try {
    const stored = Number(localStorage.getItem(SIZE_KEY));
    return SIZES.includes(stored) ? stored : DEFAULT_SIZE;
  } catch {
    return DEFAULT_SIZE;
  }
}
