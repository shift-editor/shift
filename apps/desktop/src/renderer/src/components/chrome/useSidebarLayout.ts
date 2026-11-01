import { useEffect, useRef, useState } from "react";

import type { ResizablePanelHandle, ResizablePanelProps } from "@shift/ui";

const SIDEBAR_LAYOUT_ANIMATION_DURATION_MS = 150;
const STORAGE_KEY = "shift:sidebar-layout";

type Side = "left" | "right";
const SIDES: readonly Side[] = ["left", "right"];

const SIDEBAR_SIZES = {
  left: { defaultSize: 240, minSize: 160, maxSize: 400 },
  right: { defaultSize: 260, minSize: 180, maxSize: 420 },
};

/** A sidebar's width in pixels, kept while it is collapsed so it reopens at that width. */
type SidebarLayout = Record<Side, { size: number; collapsed: boolean }>;

function loadLayout(): SidebarLayout {
  const fallback: SidebarLayout = {
    left: { size: SIDEBAR_SIZES.left.defaultSize, collapsed: false },
    right: { size: SIDEBAR_SIZES.right.defaultSize, collapsed: false },
  };
  try {
    return { ...fallback, ...JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return fallback;
  }
}

// The catalog stays mounted behind the editor, so two layouts can be live at once; each
// applies the widths the other commits.
const mountedLayouts = new Set<(layout: SidebarLayout) => void>();

/**
 * Collapsible pixel-width sidebars, shared by the catalog and editor layouts.
 *
 * @remarks
 * Sidebars keep their width when the window resizes; the centre panel absorbs the change.
 */
export const useSidebarLayout = (view: "home" | "editor") => {
  const panelRefs = {
    left: useRef<ResizablePanelHandle>(null),
    right: useRef<ResizablePanelHandle>(null),
  };
  const contentRefs = { left: useRef<HTMLDivElement>(null), right: useRef<HTMLDivElement>(null) };
  const layoutRef = useRef<SidebarLayout>(null);
  layoutRef.current ??= loadLayout();
  // Re-renders only when a sidebar opens or closes, never while one is dragged.
  const [open, setOpen] = useState(() => openSides(layoutRef.current!));
  const syncOpen = (layout: SidebarLayout) => {
    const next = openSides(layout);
    setOpen((previous) =>
      previous.left === next.left && previous.right === next.right ? previous : next,
    );
  };
  const animationTimeoutRef = useRef<number | null>(null);

  const applyLayout = (layout: SidebarLayout) => {
    layoutRef.current = layout;
    syncOpen(layout);
    for (const side of SIDES) {
      const panel = panelRefs[side].current;
      if (!panel) continue;
      if (layout[side].collapsed) panel.collapse();
      else panel.resize(layout[side].size);
    }
  };

  useEffect(() => {
    mountedLayouts.add(applyLayout);
    return () => {
      mountedLayouts.delete(applyLayout);
    };
  });

  // Only on unmount: toggling re-renders mid-animation, and cancelling then
  // would leave the content pinned to its animation width.
  useEffect(
    () => () => {
      if (animationTimeoutRef.current !== null) window.clearTimeout(animationTimeoutRef.current);
    },
    [],
  );

  const commit = (layout: SidebarLayout) => {
    layoutRef.current = layout;
    syncOpen(layout);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Without storage the layout still applies for this session.
    }
    for (const apply of mountedLayouts) if (apply !== applyLayout) apply(layout);
  };

  /** Commits the widths after the user drags or nudges a divider. */
  const onLayoutChanged = (
    sizes: Record<string, number>,
    { isUserInteraction }: { isUserInteraction: boolean },
  ) => {
    if (!isUserInteraction) return;
    // The panels report their new size only after this callback, so read it from `sizes`
    // (percentages of the group).
    const group = contentRefs.left.current?.closest("[data-group]");
    if (!group) return;
    const groupWidth = group.getBoundingClientRect().width;
    const layout = { ...layoutRef.current! };
    for (const side of SIDES) {
      const percent = sizes[`${view}-${side}-sidebar`] ?? 0;
      const collapsed = percent === 0;
      layout[side] = {
        size: collapsed ? layout[side].size : (percent / 100) * groupWidth,
        collapsed,
      };
    }
    commit(layout);
  };

  const toggleSidebar = (side: Side) => {
    const panel = panelRefs[side].current;
    const content = contentRefs[side].current;
    const group = content?.closest<HTMLElement>("[data-group]");
    if (!panel || !content || !group) return;

    const { size, collapsed } = layoutRef.current![side];
    // The content keeps its width while the panel animates, so it clips instead of reflowing.
    content.style.width = `${collapsed ? size : content.getBoundingClientRect().width}px`;
    group.classList.add("sidebar-layout-animating");
    if (collapsed) panel.resize(size);
    else panel.collapse();
    commit({ ...layoutRef.current!, [side]: { size, collapsed: !collapsed } });

    if (animationTimeoutRef.current !== null) window.clearTimeout(animationTimeoutRef.current);
    animationTimeoutRef.current = window.setTimeout(() => {
      group.classList.remove("sidebar-layout-animating");
      if (!panel.isCollapsed()) content.style.width = "";
      animationTimeoutRef.current = null;
    }, SIDEBAR_LAYOUT_ANIMATION_DURATION_MS);
  };

  const resetSidebar = (side: Side) => {
    const size = SIDEBAR_SIZES[side].defaultSize;
    panelRefs[side].current?.resize(size);
    commit({ ...layoutRef.current!, [side]: { size, collapsed: false } });
  };

  const sidebarPanelProps = (side: Side) => {
    const { size, collapsed } = layoutRef.current![side];
    return {
      id: `${view}-${side}-sidebar`,
      panelRef: panelRefs[side],
      defaultSize: collapsed ? 0 : size,
      minSize: SIDEBAR_SIZES[side].minSize,
      maxSize: SIDEBAR_SIZES[side].maxSize,
      collapsible: true,
      collapsedSize: 0,
      groupResizeBehavior: "preserve-pixel-size",
    } satisfies Partial<ResizablePanelProps>;
  };

  return {
    leftSidebarContentRef: contentRefs.left,
    rightSidebarContentRef: contentRefs.right,
    onLayoutChanged,
    sidebarPanelProps,
    leftSidebarOpen: open.left,
    rightSidebarOpen: open.right,
    toggleLeftSidebar: () => toggleSidebar("left"),
    toggleRightSidebar: () => toggleSidebar("right"),
    resetLeftSidebar: () => resetSidebar("left"),
    resetRightSidebar: () => resetSidebar("right"),
  };
};

function openSides(layout: SidebarLayout): Record<Side, boolean> {
  return { left: !layout.left.collapsed, right: !layout.right.collapsed };
}
