import { useLayoutEffect, useRef } from "react";

/**
 * Keeps a scroll container's content under the pointer when a section above
 * the viewport bottom collapses.
 *
 * @remarks
 * Shrinking content while scrolled near the end makes the browser clamp
 * `scrollTop`, which moves everything down under the cursor. The returned
 * spacer is grown to exactly the space the current scroll position needs and
 * shrinks away as the user scrolls back up. Disable native scroll anchoring on
 * the container (`overflow-anchor: none`) so the browser does not also adjust.
 *
 * @returns Refs for the scroll container, its content, and a trailing spacer
 * rendered after the content inside the container.
 */
export function useStableCollapseScroll() {
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    const spacer = spacerRef.current;
    if (!scroller || !content || !spacer) return;

    let scrollTop = scroller.scrollTop;
    let contentHeight = content.offsetHeight;

    const fitSpacer = () => {
      const needed = Math.max(0, scrollTop + scroller.clientHeight - contentHeight);
      spacer.style.height = `${needed}px`;
    };

    const sync = () => {
      const nextContentHeight = content.offsetHeight;
      if (nextContentHeight !== contentHeight) {
        contentHeight = nextContentHeight;
        fitSpacer();
        scroller.scrollTop = scrollTop;
        return;
      }

      scrollTop = scroller.scrollTop;
      fitSpacer();
    };

    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(content);
    scroller.addEventListener("scroll", sync, { passive: true });

    return () => {
      resizeObserver.disconnect();
      scroller.removeEventListener("scroll", sync);
    };
  }, []);

  return { scrollRef, contentRef, spacerRef };
}
