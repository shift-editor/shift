import type { Editor } from "@shift/editor";
import { signal, type WritableSignal } from "@shift/editor/signals";
import type { NodeId } from "@shift/types";

/** How long after a click its second click still makes a double-click. */
const DOUBLE_CLICK_MS = 500;
/** How far, in pixels, the second click may land from the first. */
const DOUBLE_CLICK_SLOP = 4;
/** The rest of the second click's events, swallowed so they reach nothing under it. */
const SECOND_CLICK_EVENTS = ["pointerup", "mousedown", "mouseup", "click", "dblclick"] as const;

/** What a double-click is listened for on: the window, or a stand-in in tests. */
export type ClickTarget = Pick<
  Window,
  "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout"
>;

// Capture as an options object: some event targets read a bare `true` only when adding.
const CAPTURE = { capture: true } as const;

const requests = new WeakMap<Editor, WritableSignal<NodeId | null>>();

/**
 * The page a pages list should start renaming, or null.
 *
 * @remarks
 * Set by a double-click whose first click opened the page from elsewhere; the
 * pages list that takes requests starts renaming it and clears the request.
 */
export function pageRenameRequests(editor: Editor): WritableSignal<NodeId | null> {
  let request = requests.get(editor);
  if (!request) {
    request = signal<NodeId | null>(null, { name: "desktop.pageRenameRequest" });
    requests.set(editor, request);
  }
  return request;
}

/**
 * Asks for a page to be renamed if the click that just opened it turns into a double-click.
 *
 * @remarks
 * Opening a page from the font overview swaps the view on the first click, so the
 * second click lands on the page's canvas, not on the row that was clicked. A
 * second press near the first within the double-click time is taken as the
 * double-click: its events are swallowed, so it acts on nothing under it, and
 * the page's rename is requested.
 *
 * @param at - where the first click landed, in viewport pixels.
 */
export function renameOnDoubleClick(
  editor: Editor,
  pageId: NodeId,
  at: { readonly x: number; readonly y: number },
  target: ClickTarget = window,
): void {
  const swallow = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  const stopSwallowing = () => {
    for (const type of SECOND_CLICK_EVENTS) target.removeEventListener(type, swallow, CAPTURE);
  };
  const stopListening = () => {
    target.removeEventListener("pointerdown", onPointerDown, CAPTURE);
    target.clearTimeout(timer);
  };
  const onPointerDown = (event: PointerEvent) => {
    stopListening();
    if (Math.hypot(event.clientX - at.x, event.clientY - at.y) > DOUBLE_CLICK_SLOP) return;

    swallow(event);
    for (const type of SECOND_CLICK_EVENTS) target.addEventListener(type, swallow, CAPTURE);
    target.setTimeout(stopSwallowing, DOUBLE_CLICK_MS);
    pageRenameRequests(editor).set(pageId);
  };

  target.addEventListener("pointerdown", onPointerDown, CAPTURE);
  const timer = target.setTimeout(stopListening, DOUBLE_CLICK_MS);
}
