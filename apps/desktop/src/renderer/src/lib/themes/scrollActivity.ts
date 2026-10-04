const SCROLLING_ATTRIBUTE = "data-scrolling";
const IDLE_DELAY_MS = 800;

/**
 * Marks each scrolled element with `data-scrolling` until it has been idle for a moment,
 * so the global scrollbar styles in `index.css` can show the thumb only while the user is scrolling.
 *
 * Listens once on the document in the capture phase, because `scroll` does not bubble.
 * Returns a function that removes the listener and clears pending idle timers.
 */
export function trackScrollActivity(root: Document = document): () => void {
  const idleTimers = new Map<Element, number>();

  const onScroll = (event: Event) => {
    const element = event.target;
    if (!(element instanceof Element)) return;

    element.setAttribute(SCROLLING_ATTRIBUTE, "");
    window.clearTimeout(idleTimers.get(element));
    idleTimers.set(
      element,
      window.setTimeout(() => {
        element.removeAttribute(SCROLLING_ATTRIBUTE);
        idleTimers.delete(element);
      }, IDLE_DELAY_MS),
    );
  };

  root.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    root.removeEventListener("scroll", onScroll, { capture: true });
    for (const timer of idleTimers.values()) window.clearTimeout(timer);
    idleTimers.clear();
  };
}
