import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IRenderer } from "@/types/graphics";
import type { FontMetrics } from "@shift/types";
import { resolveDrawStyle } from "@/lib/styles/style";
import { renderTextRun } from "./textRun";
import type { RenderContext } from "./types";
import type { TextRunState } from "../../managers/TextRunManager";

function createMockRenderer(): IRenderer {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    clear: vi.fn(),
    lineWidth: 1,
    strokeStyle: "black",
    fillStyle: "white",
    antiAlias: false,
    dashPattern: [],
    setStyle: vi.fn(),
    drawLine: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillCircle: vi.fn(),
    strokeCircle: vi.fn(),
    createPath: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadTo: vi.fn(),
    cubicTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillPath: vi.fn(),
    strokePath: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    transform: vi.fn(),
  };
}

const metrics: FontMetrics = {
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  capHeight: 700,
  xHeight: 500,
  lineGap: 0,
  italicAngle: null,
  underlinePosition: null,
  underlineThickness: null,
};

function createSlot(
  unicode: number,
  x: number,
  advance = 500,
  svgPath = "M0 0L100 0L100 100L0 100Z",
) {
  return {
    glyph: { glyphName: `uni${unicode.toString(16).toUpperCase()}`, unicode },
    unicode,
    x,
    advance,
    bounds: null,
    svgPath,
    selected: false,
  };
}

function createState(overrides: Partial<TextRunState> = {}): TextRunState {
  return {
    layout: {
      slots: [createSlot(65, 100)],
      totalAdvance: 500,
    },
    editingIndex: null,
    editingGlyph: null,
    hoveredIndex: null,
    compositeInspection: null,
    cursorX: null,
    ...overrides,
  };
}

function createRenderContext(ctx: IRenderer): RenderContext {
  const rc: RenderContext = {
    ctx,
    pxToUpm: (px = 1) => px,
    applyStyle: (style) => {
      ctx.setStyle(resolveDrawStyle(style, (px) => rc.pxToUpm(px)));
    },
  };
  return rc;
}

describe("textRun pass", () => {
  let ctx: IRenderer;
  let rc: RenderContext;

  beforeEach(() => {
    ctx = createMockRenderer();
    rc = createRenderContext(ctx);
  });

  it("strokes hovered cached glyph path instead of slot rectangle", () => {
    const state = createState({ hoveredIndex: 0 });
    renderTextRun(rc, state, metrics);

    expect(ctx.strokePath).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });

  it("strokes hovered live glyph outline via renderer path pipeline", () => {
    const state = createState({ hoveredIndex: 0 });
    const liveGlyph = {
      glyphName: "uni41",
      unicode: 65,
      contours: [
        {
          id: 1,
          closed: true,
          points: [
            { id: 1, x: 0, y: 0, pointType: "onCurve" as const, smooth: false },
            { id: 2, x: 100, y: 0, pointType: "onCurve" as const, smooth: false },
            { id: 3, x: 100, y: 100, pointType: "onCurve" as const, smooth: false },
          ],
        },
      ],
      compositeContours: [],
    };

    renderTextRun(rc, state, metrics, liveGlyph);

    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.strokePath).not.toHaveBeenCalled();
  });

  it("renders live glyph when only composite contours are present", () => {
    const state = createState();
    const liveGlyph = {
      glyphName: "uni41",
      unicode: 65,
      contours: [],
      compositeContours: [
        {
          closed: true,
          points: [
            { x: 0, y: 0, pointType: "onCurve" as const, smooth: false },
            { x: 100, y: 0, pointType: "onCurve" as const, smooth: false },
            { x: 100, y: 100, pointType: "onCurve" as const, smooth: false },
          ],
        },
      ],
    };

    renderTextRun(rc, state, metrics, liveGlyph);

    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(ctx.fillPath).not.toHaveBeenCalled();
  });

  it("renders both live base and composite contours", () => {
    const state = createState();
    const liveGlyph = {
      glyphName: "uni41",
      unicode: 65,
      contours: [
        {
          id: 1,
          closed: true,
          points: [
            { id: 1, x: 0, y: 0, pointType: "onCurve" as const, smooth: false },
            { id: 2, x: 100, y: 0, pointType: "onCurve" as const, smooth: false },
            { id: 3, x: 100, y: 100, pointType: "onCurve" as const, smooth: false },
          ],
        },
      ],
      compositeContours: [
        {
          closed: true,
          points: [
            { x: 200, y: 0, pointType: "onCurve" as const, smooth: false },
            { x: 300, y: 0, pointType: "onCurve" as const, smooth: false },
            { x: 300, y: 100, pointType: "onCurve" as const, smooth: false },
          ],
        },
      ],
    };

    renderTextRun(rc, state, metrics, liveGlyph);

    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
  });

  it("renders all same-unicode slots with live contours", () => {
    const state = createState({
      layout: {
        slots: [
          createSlot(65, 100),
          createSlot(66, 600, 450, "M0 0L90 0L90 90L0 90Z"),
          createSlot(65, 1050),
        ],
        totalAdvance: 1450,
      },
    });
    const liveGlyph = {
      glyphName: "uni41",
      unicode: 65,
      contours: [
        {
          id: 1,
          closed: true,
          points: [
            { id: 1, x: 0, y: 0, pointType: "onCurve" as const, smooth: false },
            { id: 2, x: 100, y: 0, pointType: "onCurve" as const, smooth: false },
            { id: 3, x: 100, y: 100, pointType: "onCurve" as const, smooth: false },
          ],
        },
      ],
      compositeContours: [],
    };

    renderTextRun(rc, state, metrics, liveGlyph);

    expect(ctx.fill).toHaveBeenCalledTimes(2);
    expect(ctx.fillPath).toHaveBeenCalledTimes(1);
  });

  it("uses live hover stroke for duplicate unicode at a different x", () => {
    const state = createState({
      hoveredIndex: 1,
      layout: {
        slots: [createSlot(65, 100), createSlot(65, 700)],
        totalAdvance: 1000,
      },
    });
    const liveGlyph = {
      glyphName: "uni41",
      unicode: 65,
      contours: [
        {
          id: 1,
          closed: true,
          points: [
            { id: 1, x: 0, y: 0, pointType: "onCurve" as const, smooth: false },
            { id: 2, x: 100, y: 0, pointType: "onCurve" as const, smooth: false },
            { id: 3, x: 100, y: 100, pointType: "onCurve" as const, smooth: false },
          ],
        },
      ],
      compositeContours: [],
    };

    renderTextRun(rc, state, metrics, liveGlyph);

    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.strokePath).not.toHaveBeenCalled();
  });

  it("keeps skipping the edited slot while updating other matching duplicates live", () => {
    const state = createState({
      editingIndex: 1,
      layout: {
        slots: [createSlot(65, 100), createSlot(65, 600), createSlot(65, 1100)],
        totalAdvance: 1500,
      },
    });
    const liveGlyph = {
      glyphName: "uni41",
      unicode: 65,
      contours: [
        {
          id: 1,
          closed: true,
          points: [
            { id: 1, x: 0, y: 0, pointType: "onCurve" as const, smooth: false },
            { id: 2, x: 100, y: 0, pointType: "onCurve" as const, smooth: false },
            { id: 3, x: 100, y: 100, pointType: "onCurve" as const, smooth: false },
          ],
        },
      ],
      compositeContours: [],
    };

    renderTextRun(rc, state, metrics, liveGlyph);

    expect(ctx.fill).toHaveBeenCalledTimes(2);
    expect(ctx.fillPath).not.toHaveBeenCalled();
  });
});
