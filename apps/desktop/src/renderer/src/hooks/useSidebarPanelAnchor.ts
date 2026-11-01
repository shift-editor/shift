import { useMemo, useRef } from "react";

/** A rectangle Base UI positions a popup against, in place of an element. */
interface VirtualAnchor {
  getBoundingClientRect(): DOMRect;
}

/**
 * Returns the rectangle a sidebar section's panel opens against: the sidebar's
 * left and right edges, and the section's top and bottom.
 *
 * @returns null outside a sidebar section, when the panel falls back to its trigger.
 */
export function sidebarPanelAnchor(trigger: Element | null): VirtualAnchor | null {
  const sidebar = trigger?.closest("aside");
  const section = trigger?.closest("[data-sidebar-section]");
  if (!sidebar || !section) return null;

  return {
    getBoundingClientRect() {
      const edges = sidebar.getBoundingClientRect();
      const block = section.getBoundingClientRect();
      return new DOMRect(edges.left, block.top, edges.width, block.height);
    },
  };
}

/**
 * Places a sidebar section's panel beside the sidebar, as the kerning groups
 * panel is: its edge on the sidebar's edge, its top on the section's top.
 *
 * @remarks
 * Put `triggerRef` on the section action that opens the panel and spread
 * `positioner` on its positioner. Panels of the left sidebar open to its right;
 * those of the right sidebar, to its left.
 *
 * @param side - which side of the sidebar the panel opens on.
 */
export function useSidebarPanelAnchor(side: "left" | "right" = "right") {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const positioner = useMemo(
    () => ({
      anchor: () => sidebarPanelAnchor(triggerRef.current),
      side,
      align: "start" as const,
      // Overlap the sidebar's border and the section's top rule, so the panel joins them.
      sideOffset: -1,
      alignOffset: -1,
    }),
    [side],
  );
  return { triggerRef, positioner };
}
