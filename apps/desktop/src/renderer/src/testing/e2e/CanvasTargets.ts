import type { Editor } from "@shift/editor";
import {
  localPoint,
  type LocalPoint,
  type ScenePoint,
  type ScreenPoint,
} from "@shift/editor/spaces";
import type { Point2D } from "@shift/geo";
import { ascending, comparing, type PointId, type SegmentId, type TextItemId } from "@shift/types";

/** One point's position in glyph units, on the canvas, and on the page. */
export interface PointProjection {
  readonly id: PointId;
  readonly glyphPosition: LocalPoint;
  readonly canvasPosition: ScreenPoint;
  readonly pagePosition: Point2D;
}

/** A drag of one visible point: where it starts and ends on the page, and where the point lands. */
export interface VisiblePointDrag {
  readonly id: PointId;
  readonly startPagePosition: Point2D;
  readonly endPagePosition: Point2D;
  readonly expectedGlyphPosition: LocalPoint;
}

/** A line segment as Cmd-hover would upgrade it. */
export interface LineSegmentUpgrade {
  readonly id: SegmentId;
  /** The control points the upgrade places at one and two thirds, in glyph units. */
  readonly controls: Point2D[];
  readonly sceneControls: Point2D[];
  /** The segment's middle, canvas-local. */
  readonly hover: Point2D;
}

/**
 * Where an E2E spec aims the pointer, and the input steps it needs to aim it: positions on the
 * canvas from the editor's camera and hit testing, never asserted themselves.
 *
 * @remarks
 * Served through the E2E hook for test launches only. What a spec asserts comes from the app
 * readers; each method here says why it is not a read.
 */
export class CanvasTargets {
  readonly #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  /**
   * A scene position on the canvas, in canvas-local pixels.
   *
   * Not a read: the camera transform moves with every pan and zoom; a spec aims with it, it never asserts it.
   */
  sceneToCanvas(position: ScenePoint): ScreenPoint {
    return this.#editor.sceneToScreen(position);
  }

  /**
   * A canvas-local position in the scene.
   *
   * Not a read: see sceneToCanvas.
   */
  canvasToScene(position: ScreenPoint): ScenePoint {
    return this.#editor.screenToScene(position);
  }

  /**
   * A position in the open glyph's units on the canvas, in canvas-local pixels.
   *
   * Not a read: see sceneToCanvas.
   */
  glyphToCanvas(position: LocalPoint): ScreenPoint {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    if (!node) throw new Error("Expected an open glyph node");

    return editor.sceneToScreen(editor.toScene(node, position));
  }

  /**
   * A canvas-local position in the open glyph's units.
   *
   * Not a read: see sceneToCanvas.
   */
  canvasToGlyph(position: ScreenPoint): LocalPoint {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    if (!node) throw new Error("Expected an open glyph node");

    return editor.toLocal(node, editor.screenToScene(position));
  }

  /**
   * Where each point is in glyph units, on the canvas and on the page; throws when one is absent.
   *
   * Not a read: pairs a read (the point) with the camera, for aiming the pointer.
   */
  pointProjections(ids: readonly PointId[]): PointProjection[] {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    const layer = node ? editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId) : null;
    const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
    if (!node || !layer || !canvas) throw new Error("Expected editable glyph");

    const bounds = canvas.getBoundingClientRect();
    return ids.map((id) => {
      const point = layer.point(id);
      if (!point) throw new Error(`Expected editable point ${id}`);

      const canvasPosition = editor.sceneToScreen(
        editor.toScene(node, { x: point.x, y: point.y } as LocalPoint),
      );
      return {
        id,
        glyphPosition: localPoint(point.x, point.y),
        canvasPosition,
        pagePosition: { x: bounds.left + canvasPosition.x, y: bounds.top + canvasPosition.y },
      };
    });
  }

  /**
   * A drag of the on-curve point nearest the canvas centre that sits well inside the canvas,
   * 40 by 30 pixels down and right; throws when no point is visible.
   *
   * Not a read: picks a target on screen, which depends on the window size and camera.
   */
  visiblePointDrag(): VisiblePointDrag {
    const editor = this.#editor;
    const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
    const node = editor.scene.first("glyph");
    const layer = node ? editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId) : null;
    if (!canvas || !node || !layer) throw new Error("Expected editable glyph");

    const bounds = canvas.getBoundingClientRect();
    const centre = { x: bounds.width / 2, y: bounds.height / 2 };
    const distanceToCentre = (screen: Point2D) =>
      Math.hypot(screen.x - centre.x, screen.y - centre.y);
    const candidates = layer.allPoints
      .filter((candidate) => candidate.isOnCurve)
      .map((candidate) => ({
        point: candidate,
        screen: editor.sceneToScreen(
          editor.toScene(node, { x: candidate.x, y: candidate.y } as LocalPoint),
        ),
      }))
      .filter(
        ({ screen }) =>
          screen.x >= 50 &&
          screen.y >= 50 &&
          screen.x <= bounds.width - 100 &&
          screen.y <= bounds.height - 100,
      )
      .sort(comparing(({ screen }) => distanceToCentre(screen), ascending));
    const candidate = candidates[0];
    if (!candidate) throw new Error("Expected visible on-curve point");

    const endScreen = { x: candidate.screen.x + 40, y: candidate.screen.y + 30 };
    const endScene = editor.screenToScene(endScreen as ScreenPoint);
    return {
      id: candidate.point.id,
      startPagePosition: {
        x: bounds.left + candidate.screen.x,
        y: bounds.top + candidate.screen.y,
      },
      endPagePosition: { x: bounds.left + endScreen.x, y: bounds.top + endScreen.y },
      expectedGlyphPosition: editor.toLocal(node, endScene),
    };
  }

  /**
   * The first unselected on-curve point and its page position; throws when none exists.
   *
   * Not a read: picks a target on screen, which depends on the window size and camera.
   */
  unselectedPoint(): { id: PointId; x: number; y: number } {
    const editor = this.#editor;
    const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
    const node = editor.scene.first("glyph");
    const layer = node ? editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId) : null;
    if (!canvas || !node || !layer) throw new Error("Expected editable glyph");

    const point = layer.allPoints.find(
      (candidate) => candidate.isOnCurve && !editor.selection.has(candidate.id),
    );
    if (!point) throw new Error("Expected unselected point");

    const screen = editor.sceneToScreen(
      editor.toScene(node, { x: point.x, y: point.y } as LocalPoint),
    );
    const bounds = canvas.getBoundingClientRect();
    return { id: point.id, x: bounds.left + screen.x, y: bounds.top + screen.y };
  }

  /**
   * A page position where the canvas hit-tests the selected component, searched on a grid
   * inside its bounds; throws when no component is selected or none of the grid hits it.
   *
   * Not a read: searches the canvas hit test for a position to click.
   */
  selectedComponentHitPoint(): Point2D {
    const editor = this.#editor;
    const [componentId] = editor.selection.ids;
    const object = componentId ? editor.object(componentId) : null;
    const bounds = object?.kind === "component" ? object.bounds() : null;
    const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
    if (!componentId || !object || !bounds || !canvas) {
      throw new Error("Expected selected component bounds");
    }

    const canvasBounds = canvas.getBoundingClientRect();
    for (let row = 1; row < 20; row += 1) {
      for (let column = 1; column < 20; column += 1) {
        const local = {
          x: bounds.min.x + ((bounds.max.x - bounds.min.x) * column) / 20,
          y: bounds.min.y + ((bounds.max.y - bounds.min.y) * row) / 20,
        };
        const scene = editor.toScene(object.node, local as LocalPoint);
        const target = editor.getPointerTarget(scene);
        if (target.kind !== "component" || target.id !== componentId) continue;

        const screen = editor.sceneToScreen(scene);
        return { x: canvasBounds.left + screen.x, y: canvasBounds.top + screen.y };
      }
    }

    throw new Error("Expected a hittable component position");
  }

  /**
   * The canvas-local position of the middle of the open glyph's first segment.
   *
   * Not a read: a position to hover, from the camera.
   */
  firstSegmentMidpoint(): Point2D {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    if (!node) throw new Error("Expected glyph node");
    const layer = editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId);
    const segment = layer?.contours[0]?.segments()[0];
    if (!segment) throw new Error("Expected segment");

    return editor.sceneToScreen(editor.toScene(node, segment.pointAt(0.5) as LocalPoint));
  }

  /**
   * The first line segment of the open glyph's first contour, as Cmd-hover would upgrade it.
   *
   * Not a read: a position to Cmd-hover, from the camera, and the expected handles there.
   */
  lineSegmentUpgrade(): LineSegmentUpgrade {
    const editor = this.#editor;
    const node = editor.scene.first("glyph")!;
    const layer = editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!;
    const segment = layer.contours[0]!.segments().find((candidate) => candidate.type === "line");
    if (!segment) throw new Error("Expected line segment");
    const middle = segment.pointAt(1 / 2);
    return {
      id: segment.id,
      controls: [1 / 3, 2 / 3].map((t) => segment.pointAt(t)),
      sceneControls: [1 / 3, 2 / 3].map((t) =>
        editor.toScene(node, segment.pointAt(t) as LocalPoint),
      ),
      hover: editor.sceneToScreen(editor.toScene(node, { x: middle.x, y: middle.y } as LocalPoint)),
    };
  }

  /**
   * The canvas-local position inside one half of the text run's spacing gap `gapIndex`, at
   * `height` of the line's height from its top (0.5 is the middle, where the value pill sits).
   *
   * Not a read: a position to hover inside a spacing gap, from the text run layout and camera.
   */
  spacingHalfCanvasPoint(gapIndex: number, side: "left" | "right", height: number): Point2D {
    const editor = this.#editor;
    const run = editor.scene.first("textRun")!;
    const gap = editor.nodeDefinition("textRun").spacingGaps(run)[gapIndex]!;
    const half = gap[side]!;
    const point = {
      x: (half.edge + (side === "left" ? gap.leftBoundary : gap.rightBoundary)) / 2,
      y: gap.top + (gap.bottom - gap.top) * height,
    };
    return editor.sceneToScreen(editor.toScene(run, point as LocalPoint));
  }

  /**
   * Canvas-local positions over the canvas text run's glyphs 2 to 40 that hit-test as text and
   * lie inside a canvas of `size`, each with the text item it hits.
   *
   * Not a read: searches the canvas hit test for text positions to hover.
   */
  textRunHoverTargets(size: {
    width: number;
    height: number;
  }): { itemId: TextItemId; position: Point2D }[] {
    const editor = this.#editor;
    const run = editor.scene.first("textRun");
    const layout = run ? editor.text.layoutCell(run.runId).peek() : null;
    if (!run || !layout) throw new Error("Expected the canvas run");

    const found: { itemId: TextItemId; position: Point2D }[] = [];
    for (const placed of layout.placedGlyphs.slice(1, 40)) {
      // Between the bowl's outer and inner rings, inside every letter's fill.
      const local = { x: placed.left + placed.glyph.xAdvance / 2, y: 35 } as LocalPoint;
      const scene = editor.toScene(run, local);
      const target = editor.getPointerTarget(scene as ScenePoint);
      const screen = editor.sceneToScreen(scene);
      const onCanvas =
        screen.x > 0 && screen.y > 0 && screen.x < size.width && screen.y < size.height;
      if (target.kind === "text" && onCanvas) {
        found.push({ itemId: target.itemId, position: screen });
      }
    }
    return found;
  }

  /**
   * Dispatches a Ctrl-wheel zoom and then a modifier-free horizontal wheel sample at the canvas
   * centre in one synchronous task, so their timestamps rather than round trips decide whether
   * the second sample continues the zoom gesture.
   *
   * @returns the pan after the zoom, the pan after the second sample, and the page time of the zoom.
   *
   * Not a read: dispatches two wheel events in one task, which the page cannot time from outside.
   */
  wheelZoomThenPan(): { zoomPan: Point2D; momentumPan: Point2D; zoomedAt: number } {
    const editor = this.#editor;
    const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
    if (!canvas) throw new Error("Expected editor canvas");

    const bounds = canvas.getBoundingClientRect();
    const wheel = (init: WheelEventInit) =>
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top + bounds.height / 2,
          deltaMode: 0,
          ...init,
        }),
      );

    wheel({ ctrlKey: true, deltaY: -100 });
    const zoomPan = { x: editor.pan.x, y: editor.pan.y };
    const zoomedAt = performance.now();
    wheel({ deltaX: 30, deltaY: 0 });
    return { zoomPan, momentumPan: { x: editor.pan.x, y: editor.pan.y }, zoomedAt };
  }

  /**
   * Delivers the latest coalesced pointer move to the active tool, as the next frame would.
   *
   * Not a read: drives the frame loop, which a test needs to step gestures deterministically.
   */
  flushPointerMoves(): void {
    this.#editor.toolManager.flushPointerMoves();
  }

  /**
   * Pans the canvas to `offset`, in screen pixels, as the Hand tool does.
   *
   * Not a read: no UI sets an exact pan; specs set it to frame a golden.
   */
  setPan(offset: Point2D): void {
    this.#editor.setPan(offset);
  }

  /**
   * Clears the selection without a key or pointer event, as an undo or agent edit can.
   *
   * Not a read: clears without a key or pointer event, as an undo or agent edit does.
   */
  clearSelection(): void {
    this.#editor.selection.clear();
  }

  /**
   * Moves the open glyph's placement to (200, -300), zooms in one step, and pastes an open
   * contour of four points across the canvas's vertical middle, two of them just past its left
   * and right edges and one 2px inside the left edge.
   *
   * Not a read: places content relative to the canvas edges, from the camera.
   */
  async insertEdgeOverlappingContour(): Promise<void> {
    const editor = this.#editor;
    const node = editor.scene.first("glyph")!;
    // A glyph inside a text run is placed by the run, so move the run.
    const placement = editor.scene.node(node.parentId) ?? node;
    editor.scene.updateNode({ id: placement.id, position: { x: 200, y: -300 } });
    const placed = editor.scene.node(node.id)!;
    editor.zoomIn();
    const camera = editor.getCameraTransform();
    const width = camera.logicalWidth;
    const inserted = editor.insertContent({
      contours: [
        {
          closed: false,
          points: [-100, -2, width / 2, width + 100].map((x) => {
            const scene = editor.screenToScene({ x, y: camera.logicalHeight / 2 } as ScreenPoint);
            const local = editor.toLocal(placed, scene);
            return { x: local.x, y: local.y, pointType: "onCurve" as const, smooth: false };
          }),
        },
      ],
    });
    if (!inserted) throw new Error("Expected inserted points");
  }
}
