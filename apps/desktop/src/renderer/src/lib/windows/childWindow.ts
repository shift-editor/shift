import { trackScrollActivity } from "@/lib/themes/scrollActivity";
/** Where and how big a window is on screen, in CSS pixels. */
export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ChildWindowOptions {
  /** Names the window, so opening it again reuses it. */
  readonly name: string;
  readonly title: string;
  readonly bounds: WindowBounds;
}

/** A real OS window sharing this renderer's JavaScript, with the app's styles and theme. */
export interface ChildWindow {
  readonly window: Window;
  /** An empty element filling the window's body, to render into. */
  readonly container: HTMLElement;
  /** The window's bounds now, to restore them next time. */
  bounds(): WindowBounds;
  close(): void;
}

/**
 * Opens a child window running in this renderer, so it shares every object
 * and signal with the window that opened it. The app's stylesheets and theme
 * attributes are copied in and kept in step.
 *
 * @returns null when the window could not be opened.
 */
export function openChildWindow(options: ChildWindowOptions): ChildWindow | null {
  const { x, y, width, height } = options.bounds;
  const child = window.open("", options.name, `left=${x},top=${y},width=${width},height=${height}`);
  if (!child) return null;

  const doc = child.document;
  doc.title = options.title;
  doc.head.replaceChildren(...copyStyles(document.head, doc));
  const syncStyles = new MutationObserver(() =>
    doc.head.replaceChildren(...copyStyles(document.head, doc)),
  );
  syncStyles.observe(document.head, { childList: true, subtree: true, characterData: true });

  copyAttributes(document.documentElement, doc.documentElement);
  const syncTheme = new MutationObserver(() =>
    copyAttributes(document.documentElement, doc.documentElement),
  );
  syncTheme.observe(document.documentElement, { attributes: true });

  doc.body.className = document.body.className;
  const container = doc.createElement("div");
  container.className = "h-screen w-screen";
  doc.body.replaceChildren(container);
  // Scrollbar thumbs show while their element scrolls; this window's scrolling is tracked here.
  const stopScrollTracking = trackScrollActivity(doc);

  let closed = false;
  return {
    window: child,
    container,
    bounds: () => ({
      x: child.screenX,
      y: child.screenY,
      width: child.innerWidth,
      height: child.innerHeight,
    }),
    close: () => {
      if (closed) return;
      closed = true;
      syncStyles.disconnect();
      syncTheme.disconnect();
      stopScrollTracking();
      child.close();
    },
  };
}

/** Clones the stylesheets and style elements of `head` for `doc`. */
function copyStyles(head: HTMLHeadElement, doc: Document): Node[] {
  const styles = head.querySelectorAll('style, link[rel="stylesheet"]');
  return [...styles].map((style) => doc.importNode(style, true));
}

function copyAttributes(from: HTMLElement, to: HTMLElement): void {
  for (const name of to.getAttributeNames()) {
    if (!from.hasAttribute(name)) to.removeAttribute(name);
  }
  for (const name of from.getAttributeNames()) {
    to.setAttribute(name, from.getAttribute(name) ?? "");
  }
}
