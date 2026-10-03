import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";

export type Direction = "horizontal" | "vertical";

export interface PanelStorage {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
}

const defaultStorage: PanelStorage = {
  getItem: (name: string) => {
    if (typeof window === "undefined" || !window.localStorage) return null;
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // ignore storage quota errors
    }
  },
};

const STORAGE_PREFIX = "shift:resizable:";
const FALLBACK_EXPANDED_SIZE = 240;

type SavedPanelLayout = {
  sizes: Record<string, number>;
  lastExpandedSizes: Record<string, number>;
};

export type PanelConstraints = {
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  collapsible?: boolean;
  collapsedSize?: number;
  onResize?: (size: number, prevSize: number | undefined) => void;
  onCollapse?: () => void;
  onExpand?: () => void;
};

type HandleInset = "start" | "end";

type PanelTarget = { targetId: string; multiplier: number };

/**
 * Mutable, render-independent layout owned by one {@link ResizablePanelGroup}.
 *
 * Sizes live here rather than in React state on purpose: a drag writes straight to the DOM and
 * never re-renders the tree. The group re-renders only when its own parent does, and every such
 * render reads the sizes back from this object, so React and the DOM cannot disagree.
 */
type GroupLayout = {
  sizes: Record<string, number>;
  lastExpandedSizes: Record<string, number>;
  configs: Record<string, PanelConstraints>;
  elements: Record<string, HTMLElement | null>;
  /** Panels whose saved/default size has been resolved at least once in this group. */
  initialized: Set<string>;
  handles: Map<HTMLElement, HandleInset | undefined>;
  /** True when sizes changed since the last write to storage. */
  dirty: boolean;
};

type DragSession = {
  pointerId: number;
  initialPos: number;
  initialSize: number;
  targetId: string;
  multiplier: number;
};

interface PanelGroupContextValue {
  direction: Direction;
  registerPanel: (id: string, constraints: PanelConstraints) => void;
  unregisterPanel: (id: string) => void;
  registerPanelElement: (id: string, el: HTMLElement | null) => void;
  registerHandle: (el: HTMLElement, inset: HandleInset | undefined) => void;
  unregisterHandle: (el: HTMLElement) => void;
  getPanelSize: (id: string) => number | undefined;
  getPanelConstraints: (id: string) => PanelConstraints | undefined;
  setPanelSize: (id: string, size: number) => void;
  collapsePanel: (id: string) => void;
  expandPanel: (id: string, minSize?: number) => void;
  isPanelCollapsed: (id: string) => boolean;
  findTargetPanel: (handleEl: HTMLElement, inset?: HandleInset) => PanelTarget | null;
  persistSizes: () => void;
}

const PanelGroupContext = createContext<PanelGroupContextValue | null>(null);

const isCollapsedSize = (size: number, constraints: PanelConstraints | undefined): boolean =>
  Boolean(constraints?.collapsible) && size <= (constraints?.collapsedSize ?? 0);

/** Clamps `size` to the panel's bounds, snapping to the collapsed size for collapsible panels. */
const clampSize = (size: number, constraints: PanelConstraints | undefined): number => {
  if (isCollapsedSize(size, constraints)) return constraints?.collapsedSize ?? 0;

  const min = constraints?.minSize ?? 0;
  const max = constraints?.maxSize ?? Infinity;

  return Math.max(min, Math.min(size, max));
};

/** Clamps to the panel's bounds without snapping to the collapsed size. */
const clampExpandedSize = (size: number, constraints: PanelConstraints): number =>
  Math.max(constraints.minSize ?? 0, Math.min(size, constraints.maxSize ?? Infinity));

/** A mounted group that shares one persisted layout with every other group using its key. */
type LayoutPeer = {
  storage: PanelStorage;
  adopt: (saved: SavedPanelLayout) => void;
};

/**
 * Groups currently mounted per storage key.
 *
 * @remarks
 * The app keeps its catalog view mounted behind the editor, so two groups can share one
 * `autoSaveId` at the same time. Each loads storage once at mount, so without this a resize
 * committed in one would never reach the other.
 */
const layoutPeers = new Map<string, Set<LayoutPeer>>();

function subscribeLayoutPeer(key: string, peer: LayoutPeer): () => void {
  const peers = layoutPeers.get(key) ?? new Set<LayoutPeer>();
  peers.add(peer);
  layoutPeers.set(key, peers);

  return () => {
    peers.delete(peer);
    if (peers.size === 0) layoutPeers.delete(key);
  };
}

/** Hands a just-saved layout to every other peer reading the same key from the same storage. */
function notifyLayoutPeers(
  key: string,
  storage: PanelStorage,
  source: LayoutPeer | null,
  saved: SavedPanelLayout,
): void {
  for (const peer of layoutPeers.get(key) ?? []) {
    if (peer === source || peer.storage !== storage) continue;

    peer.adopt(saved);
  }
}

type PanelBox = { size: string; min: string; max: string };

/**
 * Main-axis CSS lengths for a fixed-size panel. Shared by render and the imperative writer so
 * both always produce identical styles.
 */
const panelBox = (size: number, constraints: PanelConstraints): PanelBox => {
  const collapsed = isCollapsedSize(size, constraints);
  const shownSize = collapsed ? (constraints.collapsedSize ?? 0) : size;
  const min = collapsed ? (constraints.collapsedSize ?? 0) : constraints.minSize;

  return {
    size: `${shownSize}px`,
    min: min === undefined ? "" : `${min}px`,
    max: constraints.maxSize === undefined ? "" : `${constraints.maxSize}px`,
  };
};

const normalizeSavedMap = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: Record<string, number> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === "number" && !isNaN(candidate) && candidate > 0) {
      result[key] = candidate;
    }
  }

  return result;
};

const emptySavedLayout = (): SavedPanelLayout => ({ sizes: {}, lastExpandedSizes: {} });

function loadSavedLayout(storage: PanelStorage, autoSaveId?: string | null): SavedPanelLayout {
  if (!autoSaveId) return emptySavedLayout();

  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${autoSaveId}`);
    if (!raw) return emptySavedLayout();

    const parsed = JSON.parse(raw);

    // Legacy shape: persisted as a direct id->size map.
    const legacySizes = normalizeSavedMap(parsed);
    if (Object.keys(legacySizes).length > 0) {
      return { sizes: legacySizes, lastExpandedSizes: {} };
    }

    return {
      sizes: normalizeSavedMap((parsed as { sizes?: unknown }).sizes),
      lastExpandedSizes: normalizeSavedMap(
        (parsed as { lastExpandedSizes?: unknown }).lastExpandedSizes,
      ),
    };
  } catch {
    return emptySavedLayout();
  }
}

function createGroupLayout(storage: PanelStorage, autoSaveId?: string | null): GroupLayout {
  const saved = loadSavedLayout(storage, autoSaveId);

  return {
    sizes: { ...saved.sizes },
    lastExpandedSizes: { ...saved.lastExpandedSizes },
    configs: {},
    elements: {},
    initialized: new Set(),
    handles: new Map(),
    dirty: false,
  };
}

/** Resolves a panel's size the first time it registers in a group. */
function resolveInitialSize(
  saved: number | undefined,
  constraints: PanelConstraints,
): number | undefined {
  if (saved === undefined) return constraints.defaultSize;

  // A saved size at or below the collapsed size is a stale collapse, not a width to restore.
  if (isCollapsedSize(saved, constraints)) {
    return constraints.defaultSize ?? constraints.minSize ?? FALLBACK_EXPANDED_SIZE;
  }

  return clampSize(saved, constraints);
}

/** Re-clamps the live size of an already-registered panel; a collapsed panel stays collapsed. */
function resolveKnownSize(
  current: number | undefined,
  constraints: PanelConstraints,
): number | undefined {
  if (current === undefined) return undefined;

  return clampSize(current, constraints);
}

/** Finds the panel a handle resizes, by walking its nearest `data-panel` siblings. */
function findTargetPanelFor(
  layout: GroupLayout,
  handleEl: HTMLElement,
  inset?: HandleInset,
): PanelTarget | null {
  let prev = handleEl.previousElementSibling;
  while (prev && !prev.hasAttribute("data-panel")) {
    prev = prev.previousElementSibling;
  }
  let next = handleEl.nextElementSibling;
  while (next && !next.hasAttribute("data-panel")) {
    next = next.nextElementSibling;
  }

  const prevId = prev?.getAttribute("data-panel-id") || null;
  const nextId = next?.getAttribute("data-panel-id") || null;

  if (inset === "start" && prevId) return { targetId: prevId, multiplier: 1 };
  if (inset === "end" && nextId) return { targetId: nextId, multiplier: -1 };

  if (prevId && layout.configs[prevId]?.defaultSize !== undefined) {
    return { targetId: prevId, multiplier: 1 };
  }
  if (nextId && layout.configs[nextId]?.defaultSize !== undefined) {
    return { targetId: nextId, multiplier: -1 };
  }
  if (prevId) return { targetId: prevId, multiplier: 1 };
  if (nextId) return { targetId: nextId, multiplier: -1 };

  return null;
}

/** Mirrors the target panel's size and bounds onto a separator's ARIA value attributes. */
function syncHandleAria(layout: GroupLayout, handleEl: HTMLElement, inset?: HandleInset): void {
  const target = findTargetPanelFor(layout, handleEl, inset);
  const config = target ? layout.configs[target.targetId] : undefined;
  const size = target ? layout.sizes[target.targetId] : undefined;
  if (!target || !config || size === undefined) {
    for (const name of ["aria-controls", "aria-valuenow", "aria-valuemin", "aria-valuemax"]) {
      handleEl.removeAttribute(name);
    }
    return;
  }

  handleEl.setAttribute("aria-controls", target.targetId);
  handleEl.setAttribute(
    "aria-valuenow",
    String(Math.round(isCollapsedSize(size, config) ? (config.collapsedSize ?? 0) : size)),
  );
  handleEl.setAttribute("aria-valuemin", String(config.minSize ?? 0));
  if (config.maxSize === undefined) {
    handleEl.removeAttribute("aria-valuemax");
    return;
  }
  handleEl.setAttribute("aria-valuemax", String(config.maxSize));
}

export type ResizablePanelGroupProps = HTMLAttributes<HTMLDivElement> & {
  direction?: Direction;
  /** Persists panel sizes under this key. Read once on mount; changing it later does not reload. */
  autoSaveId?: string | null;
  /** Backing store for `autoSaveId`; defaults to `localStorage`. */
  storage?: PanelStorage;
  className?: string;
  children?: ReactNode;
};

export const ResizablePanelGroup = ({
  direction = "horizontal",
  autoSaveId,
  storage = defaultStorage,
  className,
  children,
  ...props
}: ResizablePanelGroupProps) => {
  const [layout] = useState(() => createGroupLayout(storage, autoSaveId));
  const storageRef = useRef(storage);
  const autoSaveIdRef = useRef(autoSaveId);
  storageRef.current = storage;
  autoSaveIdRef.current = autoSaveId;
  const selfPeerRef = useRef<LayoutPeer | null>(null);

  const persistSizes = useCallback(() => {
    layout.dirty = false;

    const id = autoSaveIdRef.current;
    if (!id) return;

    // A collapsed panel is persisted as the width it will re-open at, never as zero.
    const sizes: Record<string, number> = {};
    for (const [panelId, size] of Object.entries(layout.sizes)) {
      const config = layout.configs[panelId];
      const collapsed = config ? isCollapsedSize(size, config) : size <= 0;
      const persisted = collapsed ? layout.lastExpandedSizes[panelId] : size;
      if (persisted !== undefined && persisted > 0) sizes[panelId] = persisted;
    }

    const saved: SavedPanelLayout = { sizes, lastExpandedSizes: { ...layout.lastExpandedSizes } };
    const key = `${STORAGE_PREFIX}${id}`;

    try {
      storageRef.current.setItem(key, JSON.stringify(saved));
    } catch {
      return;
    }

    notifyLayoutPeers(key, storageRef.current, selfPeerRef.current, saved);
  }, [layout]);

  useEffect(() => {
    return () => {
      if (layout.dirty) persistSizes();
    };
  }, [layout, persistSizes]);

  const syncHandles = useCallback(() => {
    for (const [handleEl, inset] of layout.handles) {
      syncHandleAria(layout, handleEl, inset);
    }
  }, [layout]);

  /** Writes a panel's current size to its element. The single imperative DOM writer. */
  const applyPanelSize = useCallback(
    (id: string) => {
      const config = layout.configs[id];
      const size = layout.sizes[id];
      const element = layout.elements[id];

      if (element && config && size !== undefined) {
        const collapsed = isCollapsedSize(size, config);
        element.setAttribute(
          "data-panel-size",
          String(collapsed ? (config.collapsedSize ?? 0) : size),
        );
        if (collapsed) {
          element.setAttribute("data-panel-collapsed", "true");
        } else {
          element.removeAttribute("data-panel-collapsed");
        }

        if (config.defaultSize !== undefined) {
          const box = panelBox(size, config);
          if (direction === "horizontal") {
            element.style.width = box.size;
            element.style.minWidth = box.min;
            element.style.maxWidth = box.max;
          } else {
            element.style.height = box.size;
            element.style.minHeight = box.min;
            element.style.maxHeight = box.max;
          }
        }
      }

      syncHandles();
    },
    [layout, direction, syncHandles],
  );

  const registerPanel = useCallback(
    (id: string, constraints: PanelConstraints) => {
      layout.configs[id] = constraints;

      const current = layout.sizes[id];
      const known = layout.initialized.has(id);
      layout.initialized.add(id);

      // Re-registering a known panel (new bounds, StrictMode remount) must keep its live size,
      // including a collapsed one, so it only re-clamps instead of resolving defaults again.
      const next = known
        ? resolveKnownSize(current, constraints)
        : resolveInitialSize(current, constraints);

      if (next !== undefined) {
        layout.sizes[id] = next;
        if (!isCollapsedSize(next, constraints)) layout.lastExpandedSizes[id] = next;
      }

      if (!known || next !== current) {
        applyPanelSize(id);
        return;
      }
      syncHandles();
    },
    [layout, applyPanelSize, syncHandles],
  );

  const unregisterPanel = useCallback(
    (id: string) => {
      delete layout.configs[id];
      delete layout.elements[id];
    },
    [layout],
  );

  const registerPanelElement = useCallback(
    (id: string, el: HTMLElement | null) => {
      layout.elements[id] = el;
    },
    [layout],
  );

  const registerHandle = useCallback(
    (el: HTMLElement, inset: HandleInset | undefined) => {
      layout.handles.set(el, inset);
      syncHandleAria(layout, el, inset);
    },
    [layout],
  );

  const unregisterHandle = useCallback(
    (el: HTMLElement) => {
      layout.handles.delete(el);
    },
    [layout],
  );

  const getPanelSize = useCallback(
    (id: string): number | undefined => layout.sizes[id] ?? layout.configs[id]?.defaultSize,
    [layout],
  );

  const getPanelConstraints = useCallback(
    (id: string): PanelConstraints | undefined => layout.configs[id],
    [layout],
  );

  const setPanelSize = useCallback(
    (id: string, newSize: number) => {
      if (!Number.isFinite(newSize)) return;

      const config = layout.configs[id];
      const prevSize = layout.sizes[id] ?? config?.defaultSize ?? 0;
      const targetSize = clampSize(newSize, config);

      if (!isCollapsedSize(targetSize, config)) {
        layout.lastExpandedSizes[id] = targetSize;
      }
      layout.sizes[id] = targetSize;
      layout.dirty = true;

      applyPanelSize(id);

      if (config?.onResize && targetSize !== prevSize) {
        config.onResize(targetSize, prevSize);
      }
    },
    [layout, applyPanelSize],
  );

  /**
   * Takes over a layout that another mounted group with the same `autoSaveId` just committed.
   *
   * @remarks
   * Does not mark the layout dirty or write storage: the saving group already did. A collapsed
   * panel stays collapsed but re-opens at the adopted width.
   */
  const adoptSavedLayout = useCallback(
    (saved: SavedPanelLayout) => {
      for (const [id, savedSize] of Object.entries(saved.sizes)) {
        const config = layout.configs[id];
        if (!config) continue;

        const expandedSize = clampExpandedSize(savedSize, config);
        layout.lastExpandedSizes[id] = expandedSize;

        const currentSize = layout.sizes[id];
        if (currentSize !== undefined && isCollapsedSize(currentSize, config)) continue;
        if (currentSize === expandedSize) continue;

        layout.sizes[id] = expandedSize;
        applyPanelSize(id);
        config.onResize?.(expandedSize, currentSize);
      }
    },
    [layout, applyPanelSize],
  );

  useEffect(() => {
    if (!autoSaveId) return;

    const peer: LayoutPeer = { storage, adopt: adoptSavedLayout };
    selfPeerRef.current = peer;
    const unsubscribe = subscribeLayoutPeer(`${STORAGE_PREFIX}${autoSaveId}`, peer);

    return () => {
      unsubscribe();
      selfPeerRef.current = null;
    };
  }, [autoSaveId, storage, adoptSavedLayout]);

  const collapsePanel = useCallback(
    (id: string) => {
      const config = layout.configs[id];
      if (!config?.collapsible) return;

      const currentSize = layout.sizes[id] ?? config.defaultSize ?? 0;
      if (!isCollapsedSize(currentSize, config)) {
        layout.lastExpandedSizes[id] = currentSize;
      }

      setPanelSize(id, config.collapsedSize ?? 0);
      config.onCollapse?.();
    },
    [layout, setPanelSize],
  );

  const expandPanel = useCallback(
    (id: string, minSize?: number) => {
      const config = layout.configs[id];
      if (!config?.collapsible) return;

      const target =
        layout.lastExpandedSizes[id] ||
        minSize ||
        config.minSize ||
        config.defaultSize ||
        FALLBACK_EXPANDED_SIZE;

      const wasCollapsed = isCollapsedSize(layout.sizes[id] ?? config.defaultSize ?? 0, config);
      setPanelSize(id, target);
      if (wasCollapsed) config.onExpand?.();
    },
    [layout, setPanelSize],
  );

  const isPanelCollapsed = useCallback(
    (id: string): boolean => {
      const config = layout.configs[id];
      if (!config?.collapsible) return false;

      return isCollapsedSize(layout.sizes[id] ?? config.defaultSize ?? 0, config);
    },
    [layout],
  );

  const findTargetPanel = useCallback(
    (handleEl: HTMLElement, inset?: HandleInset): PanelTarget | null =>
      findTargetPanelFor(layout, handleEl, inset),
    [layout],
  );

  const contextValue = useMemo<PanelGroupContextValue>(
    () => ({
      direction,
      registerPanel,
      unregisterPanel,
      registerPanelElement,
      registerHandle,
      unregisterHandle,
      getPanelSize,
      getPanelConstraints,
      setPanelSize,
      collapsePanel,
      expandPanel,
      isPanelCollapsed,
      findTargetPanel,
      persistSizes,
    }),
    [
      direction,
      registerPanel,
      unregisterPanel,
      registerPanelElement,
      registerHandle,
      unregisterHandle,
      getPanelSize,
      getPanelConstraints,
      setPanelSize,
      collapsePanel,
      expandPanel,
      isPanelCollapsed,
      findTargetPanel,
      persistSizes,
    ],
  );

  return (
    <PanelGroupContext.Provider value={contextValue}>
      <div
        data-panel-group=""
        data-panel-group-direction={direction}
        className={cn(
          "flex h-full w-full",
          direction === "vertical" ? "flex-col" : "flex-row",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </PanelGroupContext.Provider>
  );
};

export type ResizablePanelHandle = {
  collapse: () => void;
  expand: (minSize?: number) => void;
  getId: () => string;
  getSize: () => number;
  isCollapsed: () => boolean;
  isExpanded: () => boolean;
  resize: (size: number) => void;
};

export type ResizablePanelProps = Omit<HTMLAttributes<HTMLDivElement>, "id" | "onResize"> & {
  id?: string;
  /** Accepted for API compatibility; panels render in DOM order. */
  order?: number;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  collapsible?: boolean;
  collapsedSize?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  onResize?: (size: number, prevSize: number | undefined) => void;
  onCollapse?: () => void;
  onExpand?: () => void;
};

export const ResizablePanel = forwardRef<ResizablePanelHandle, ResizablePanelProps>(
  (
    {
      id: idProp,
      defaultSize,
      minSize,
      maxSize,
      collapsible = false,
      collapsedSize = 0,
      className,
      style,
      children,
      onResize,
      onCollapse,
      onExpand,
      ...props
    },
    ref,
  ) => {
    const context = useContext(PanelGroupContext);
    const generatedId = useId();
    const panelId = idProp ?? generatedId;
    const domRef = useRef<HTMLDivElement>(null);

    // Callbacks are read through a ref so an inline `onResize` never forces a re-registration.
    const callbacksRef = useRef({ onResize, onCollapse, onExpand });
    callbacksRef.current = { onResize, onCollapse, onExpand };

    useLayoutEffect(() => {
      if (!context) return;

      // The element must be known first so registration can write its resolved size.
      context.registerPanelElement(panelId, domRef.current);
      context.registerPanel(panelId, {
        defaultSize,
        minSize,
        maxSize,
        collapsible,
        collapsedSize,
        onResize: (size, prevSize) => callbacksRef.current.onResize?.(size, prevSize),
        onCollapse: () => callbacksRef.current.onCollapse?.(),
        onExpand: () => callbacksRef.current.onExpand?.(),
      });

      return () => {
        context.unregisterPanel(panelId);
      };
    }, [context, panelId, defaultSize, minSize, maxSize, collapsible, collapsedSize]);

    useImperativeHandle(
      ref,
      () => ({
        collapse: () => {
          context?.collapsePanel(panelId);
        },
        expand: (min?: number) => {
          context?.expandPanel(panelId, min);
        },
        getId: () => panelId,
        getSize: () => context?.getPanelSize(panelId) ?? defaultSize ?? 0,
        isCollapsed: () => context?.isPanelCollapsed(panelId) ?? false,
        isExpanded: () => !(context?.isPanelCollapsed(panelId) ?? false),
        resize: (newSize: number) => {
          context?.setPanelSize(panelId, newSize);
          context?.persistSizes();
        },
      }),
      [context, panelId, defaultSize],
    );

    const isFixed = defaultSize !== undefined;
    const constraints: PanelConstraints = {
      defaultSize,
      minSize,
      maxSize,
      collapsible,
      collapsedSize,
    };
    const currentSize = context?.getPanelSize(panelId) ?? defaultSize ?? 0;
    const isCollapsed = collapsible && isCollapsedSize(currentSize, constraints);
    const displaySize = isCollapsed ? collapsedSize : currentSize;
    const isHorizontal = context?.direction !== "vertical";

    const box = panelBox(currentSize, constraints);
    const panelStyle: CSSProperties = isFixed
      ? {
          ...style,
          ...(isHorizontal
            ? {
                width: box.size,
                minWidth: box.min || undefined,
                maxWidth: box.max || undefined,
                flexShrink: 0,
              }
            : {
                height: box.size,
                minHeight: box.min || undefined,
                maxHeight: box.max || undefined,
                flexShrink: 0,
              }),
        }
      : {
          ...style,
          flex: "1 1 0%",
          minWidth: isHorizontal && minSize !== undefined ? `${minSize}px` : 0,
          minHeight: !isHorizontal && minSize !== undefined ? `${minSize}px` : 0,
        };

    return (
      <div
        ref={domRef}
        id={panelId}
        data-panel=""
        data-panel-id={panelId}
        data-panel-collapsible={collapsible ? true : undefined}
        data-panel-collapsed={isCollapsed ? true : undefined}
        data-panel-size={displaySize}
        className={cn("overflow-hidden", className)}
        style={panelStyle}
        {...props}
      >
        {children}
      </div>
    );
  },
);

ResizablePanel.displayName = "ResizablePanel";

const stripAnchorClasses = (inset: HandleInset | undefined): string => {
  switch (inset) {
    case "start":
      return "data-[panel-group-direction=horizontal]:after:right-1/2 data-[panel-group-direction=vertical]:after:bottom-1/2";
    case "end":
      return "data-[panel-group-direction=horizontal]:after:left-1/2 data-[panel-group-direction=vertical]:after:top-1/2";
    default:
      return "";
  }
};

const handleInteractionState = (isDragging: boolean, isHovered: boolean): string => {
  if (isDragging) return "drag";
  if (isHovered) return "hover";

  return "idle";
};

export type ResizableHandleProps = Omit<HTMLAttributes<HTMLDivElement>, "onResize"> & {
  className?: string;
  withVisual?: boolean;
  inset?: "start" | "end";
  /** Accepted for API compatibility; the hit area is sized by the handle's own classes. */
  hitAreaMargins?: { coarse: number; fine: number };
  keyboardResizeBy?: number;
  disabled?: boolean;
};

export const ResizableHandle = ({
  className,
  withVisual = false,
  inset,
  hitAreaMargins,
  keyboardResizeBy = 10,
  disabled = false,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onPointerEnter,
  onPointerLeave,
  onKeyDown,
  ...props
}: ResizableHandleProps) => {
  const context = useContext(PanelGroupContext);
  const handleRef = useRef<HTMLDivElement>(null);

  // The active drag is read by pointermove on every frame; a ref keeps it out of render.
  const dragRef = useRef<DragSession | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const direction = context?.direction ?? "horizontal";
  const isHorizontal = direction !== "vertical";

  useLayoutEffect(() => {
    const element = handleRef.current;
    if (!context || !element) return;

    context.registerHandle(element, inset);

    return () => {
      context.unregisterHandle(element);
    };
  }, [context, inset]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerDown?.(event);
    if (
      disabled ||
      (event.button !== 0 && event.button !== undefined) ||
      !context ||
      !handleRef.current
    )
      return;

    const target = context.findTargetPanel(handleRef.current, inset);
    if (!target) return;

    const constraints = context.getPanelConstraints(target.targetId);
    const currentSize =
      context.getPanelSize(target.targetId) ??
      constraints?.defaultSize ??
      constraints?.minSize ??
      0;

    if (typeof event.currentTarget.setPointerCapture === "function") {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore in mock environments
      }
    }

    dragRef.current = {
      pointerId: event.pointerId,
      initialPos: isHorizontal ? event.clientX : event.clientY,
      initialSize: currentSize,
      targetId: target.targetId,
      multiplier: target.multiplier,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerMove?.(event);
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId || !context) return;

    const constraints = context.getPanelConstraints(drag.targetId);
    if (!constraints) {
      // The panel being resized unmounted mid-drag; there is nothing left to resize.
      dragRef.current = null;
      setIsDragging(false);
      return;
    }

    const currentPos = isHorizontal ? event.clientX : event.clientY;
    const delta = (currentPos - drag.initialPos) * drag.multiplier;
    const rawSize = drag.initialSize + delta;

    const min = constraints.minSize ?? 0;
    const max = constraints.maxSize ?? Infinity;
    const collapsedSize = constraints.collapsedSize ?? 0;

    if (constraints.collapsible) {
      if (rawSize < min / 2) {
        context.setPanelSize(drag.targetId, collapsedSize);
        return;
      }
      if (rawSize < min) {
        context.setPanelSize(drag.targetId, min);
        return;
      }
    }

    context.setPanelSize(drag.targetId, Math.max(min, Math.min(rawSize, max)));
  };

  /** Ends the active drag for `event`'s pointer and persists the layout. */
  const finishDrag = (event: React.PointerEvent<HTMLDivElement>, releaseCapture: boolean) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;

    if (releaseCapture && typeof event.currentTarget.releasePointerCapture === "function") {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    }

    dragRef.current = null;
    setIsDragging(false);
    context?.persistSizes();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerUp?.(event);
    finishDrag(event, true);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerCancel?.(event);
    finishDrag(event, true);
  };

  const handleLostPointerCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    onLostPointerCapture?.(event);
    finishDrag(event, false);
  };

  const handlePointerEnter = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerEnter?.(event);
    setIsHovered(true);
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerLeave?.(event);
    setIsHovered(false);
  };

  /** Arrow-key delta in pixels for the target panel, or 0 when the key does not resize. */
  const keyboardDelta = (key: string, multiplier: number): number => {
    const step = keyboardResizeBy * multiplier;
    if (isHorizontal) {
      if (key === "ArrowRight") return step;
      if (key === "ArrowLeft") return -step;
      return 0;
    }
    if (key === "ArrowDown") return step;
    if (key === "ArrowUp") return -step;
    return 0;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (disabled || !context || !handleRef.current) return;

    const target = context.findTargetPanel(handleRef.current, inset);
    if (!target) return;

    const constraints = context.getPanelConstraints(target.targetId);

    if (event.key === "Home" || event.key === "End") {
      const bound = event.key === "Home" ? constraints?.minSize : constraints?.maxSize;
      if (bound === undefined) return;

      event.preventDefault();
      context.setPanelSize(target.targetId, bound);
      context.persistSizes();
      return;
    }

    const delta = keyboardDelta(event.key, target.multiplier);
    if (delta === 0) return;

    event.preventDefault();
    const currentSize =
      context.getPanelSize(target.targetId) ??
      constraints?.defaultSize ??
      constraints?.minSize ??
      0;
    const min = constraints?.minSize ?? 0;
    const max = constraints?.maxSize ?? Infinity;
    context.setPanelSize(target.targetId, Math.max(min, Math.min(currentSize + delta, max)));
    context.persistSizes();
  };

  const stripAnchor = stripAnchorClasses(inset);
  const interactionState = handleInteractionState(isDragging, isHovered);

  return (
    <div
      ref={handleRef}
      role="separator"
      tabIndex={disabled ? -1 : 0}
      aria-orientation={isHorizontal ? "vertical" : "horizontal"}
      aria-disabled={disabled || undefined}
      data-resize-handle=""
      data-panel-group-direction={direction}
      data-resize-handle-state={interactionState}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onKeyDown={handleKeyDown}
      className={cn(
        inset
          ? [
              // Above the editor canvas stack (z-20) so the half of the 16px grab area that
              // overlaps the neighbouring panel still receives pointer events.
              "relative z-30 shrink-0 select-none transition-colors",
              "data-[panel-group-direction=horizontal]:-mx-2 data-[panel-group-direction=horizontal]:w-4 data-[panel-group-direction=horizontal]:cursor-col-resize",
              "data-[panel-group-direction=vertical]:-my-2 data-[panel-group-direction=vertical]:h-4 data-[panel-group-direction=vertical]:cursor-row-resize",
              "after:content-[''] after:absolute after:transition-colors",
              "data-[panel-group-direction=horizontal]:after:inset-y-0 data-[panel-group-direction=horizontal]:after:w-0.5",
              "data-[panel-group-direction=vertical]:after:inset-x-0 data-[panel-group-direction=vertical]:after:h-1",
              stripAnchor,
              "hover:after:bg-accent/90 data-[resize-handle-state=drag]:after:bg-accent data-[resize-handle-state=hover]:after:bg-accent/80",
            ]
          : [
              "relative flex select-none items-center justify-center bg-transparent transition-colors",
              "data-[panel-group-direction=horizontal]:w-0.5 data-[panel-group-direction=horizontal]:cursor-col-resize",
              "data-[panel-group-direction=vertical]:h-1 data-[panel-group-direction=vertical]:cursor-row-resize",
              "hover:bg-accent/90 data-[resize-handle-state=drag]:bg-accent data-[resize-handle-state=hover]:bg-accent/80",
            ],
        className,
      )}
      {...props}
    >
      {!inset && withVisual ? (
        <div
          className={cn(
            "rounded-full bg-line-subtle",
            "data-[panel-group-direction=horizontal]:h-8 data-[panel-group-direction=horizontal]:w-0.5",
            "data-[panel-group-direction=vertical]:h-0.5 data-[panel-group-direction=vertical]:w-8",
          )}
        />
      ) : null}
    </div>
  );
};
