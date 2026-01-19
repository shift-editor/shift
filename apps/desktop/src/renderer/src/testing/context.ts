import { vi } from "vitest";
import type {
  ToolContext,
  ScreenContext,
  SelectContext,
  EditContext,
  IndicatorContext,
} from "@/types/tool";
import type { PointId } from "@/types/ids";
import type { Rect2D } from "@/types/math";
import type { GlyphSnapshot } from "@/types/generated";
import type { CommandContext } from "@/lib/commands/Command";
import type { SegmentIndicator } from "@/types/indicator";
import { CommandHistory } from "@/lib/commands";
import { Viewport } from "@/lib/editor/Viewport";
import { asContourId } from "@/types/ids";
import {
  createMockFontEngine,
  createMockEditing,
  createTestSnapshot,
  populateEngine,
  type TestSnapshotConfig,
} from "./engine";

export function createMockCommandContext(
  snapshot: GlyphSnapshot | null = null,
): CommandContext {
  return {
    fontEngine: {
      editing: createMockEditing(),
    } as any,
    snapshot,
  };
}

export interface MockToolContextOptions {
  snapshot?: TestSnapshotConfig;
  selectedPoints?: Set<PointId>;
  hoveredPoint?: PointId | null;
  viewportSize?: { width: number; height: number };
}

export function createMockToolContext(options: MockToolContextOptions = {}) {
  const fontEngine = createMockFontEngine();
  const viewport = new Viewport();

  const size = options.viewportSize ?? { width: 1000, height: 1000 };
  const rect: Rect2D = {
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    left: 0,
    top: 0,
    right: size.width,
    bottom: size.height,
  };
  viewport.setRect(rect);

  const commandHistory = new CommandHistory(
    fontEngine,
    () => fontEngine.snapshot.value,
  );

  if (options.snapshot) {
    const snapshot = createTestSnapshot(options.snapshot);
    populateEngine(fontEngine, snapshot);
  } else {
    fontEngine.session.startEditSession(65);
    fontEngine.editing.addContour();
  }

  let selectedPoints = options.selectedPoints ?? new Set<PointId>();
  let hoveredPoint: PointId | null = options.hoveredPoint ?? null;
  let hoveredSegment: SegmentIndicator | null = null;
  let selectionMode: "preview" | "committed" = "committed";
  let redrawCount = 0;

  const screen: ScreenContext = {
    toUpmDistance: (px: number) => viewport.screenToUpmDistance(px),
    get hitRadius() {
      return viewport.screenToUpmDistance(8);
    },
    lineWidth: (px = 1) => viewport.screenToUpmDistance(px),
  };

  const select: SelectContext = {
    set: vi.fn((ids: Set<PointId>) => {
      selectedPoints = new Set(ids);
    }),
    add: vi.fn((id: PointId) => {
      selectedPoints = new Set(selectedPoints);
      selectedPoints.add(id);
    }),
    remove: vi.fn((id: PointId) => {
      selectedPoints = new Set(selectedPoints);
      selectedPoints.delete(id);
    }),
    toggle: vi.fn((id: PointId) => {
      selectedPoints = new Set(selectedPoints);
      if (selectedPoints.has(id)) {
        selectedPoints.delete(id);
      } else {
        selectedPoints.add(id);
      }
    }),
    clear: vi.fn(() => {
      selectedPoints = new Set();
    }),
    has: vi.fn(() => selectedPoints.size > 0),
    setMode: vi.fn((mode: "preview" | "committed") => {
      selectionMode = mode;
    }),
  };

  const indicators: IndicatorContext = {
    setHoveredPoint: vi.fn((id: PointId | null) => {
      hoveredPoint = id;
      if (id) hoveredSegment = null;
    }),
    setHoveredSegment: vi.fn((indicator: SegmentIndicator | null) => {
      hoveredSegment = indicator;
      if (indicator) hoveredPoint = null;
    }),
    clearAll: vi.fn(() => {
      hoveredPoint = null;
      hoveredSegment = null;
    }),
  };

  const edit: EditContext = {
    addPoint: vi.fn((x: number, y: number, type: "onCurve" | "offCurve") => {
      return fontEngine.editing.addPoint(x, y, type, false);
    }),
    movePoints: vi.fn((ids: Iterable<PointId>, dx: number, dy: number) => {
      fontEngine.editing.movePoints([...ids], dx, dy);
    }),
    movePointTo: vi.fn((id: PointId, x: number, y: number) => {
      fontEngine.editing.movePointTo(id, x, y);
    }),
    applySmartEdits: vi.fn(
      (ids: ReadonlySet<PointId>, dx: number, dy: number) => {
        return fontEngine.editEngine.applyEdits(ids, dx, dy);
      },
    ),
    removePoints: vi.fn((ids: Iterable<PointId>) => {
      fontEngine.editing.removePoints([...ids]);
    }),
    addContour: vi.fn(() => {
      return fontEngine.editing.addContour();
    }),
    closeContour: vi.fn(() => {
      fontEngine.editing.closeContour();
    }),
    toggleSmooth: vi.fn((id: PointId) => {
      fontEngine.editing.toggleSmooth(id);
    }),
    getActiveContourId: vi.fn(() => {
      const id = fontEngine.editing.getActiveContourId();
      return id ? asContourId(id) : null;
    }),
  };

  const ctx: ToolContext = {
    get snapshot() {
      return fontEngine.snapshot.value;
    },
    get selectedPoints() {
      return selectedPoints;
    },
    get hoveredPoint() {
      return hoveredPoint;
    },
    get hoveredSegment() {
      return hoveredSegment;
    },
    mousePosition: { x: 0, y: 0 },
    get selectionMode() {
      return selectionMode;
    },
    screen,
    select,
    indicators,
    edit,
    commands: commandHistory,
    requestRedraw: vi.fn(() => {
      redrawCount++;
    }),
  };

  return {
    ctx,
    fontEngine,
    commandHistory,
    viewport,
    getSelectedPoints: () => selectedPoints,
    getHoveredPoint: () => hoveredPoint,
    getRedrawCount: () => redrawCount,
    setSelectedPoints: (ids: Set<PointId>) => {
      selectedPoints = ids;
    },
  };
}
