import type { Editor } from "@shift/editor";
import { localPoint, type LocalPoint, type ScenePoint, type ScreenPoint } from "@shift/editor/spaces";
import type { MatModel, Point2D } from "@shift/geo";
import type { GlyphName, PointId, SegmentId, TextItemId } from "@shift/types";

/** The Shape tool's draft while its gesture is in flight. */
export interface ShapeDraft {
  readonly id: string | undefined;
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly points: number;
  readonly handles: boolean;
}

/** Whether the canvas text run is ready to draw. */
export interface TextRunReadiness {
  /** Each item's codepoint; 10 for anything but a character. */
  readonly codepoints: number[];
  readonly editingNodes: number;
  readonly caretAtEnd: boolean;
  readonly glyphsLoaded: boolean;
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

/** A Shift-constrained Pen drag's expected points, in glyph units. */
export interface PenSnap {
  readonly anchor: Point2D;
  readonly incoming: Point2D;
  readonly outgoing: Point2D;
}

/** A handle drag and where a Shift-constrained drag must leave the handle. */
export interface HandleSnapDrag {
  readonly id: PointId;
  readonly pivot: PointId;
  readonly down: Point2D;
  readonly end: Point2D;
  readonly expected: Point2D;
}

/** The components the canvas draws beside those an exact source's layer holds. */
export interface DrawnAndAuthoredComponents {
  readonly renderedIds: string[];
  readonly exactIds: string[];
  /** Each transform as `[a, b, c, d, e, f]`. */
  readonly renderedTransforms: number[][];
  readonly exactTransforms: number[][];
}

/**
 * Canvas geometry and in-flight tool state E2E specs check but agents do not
 * read: hit positions, projected gestures, tool previews, layer matching and
 * the drawn (interpolated) glyph.
 *
 * @remarks
 * Served through the E2E hook for test launches only. Reads of the drawn,
 * interpolated glyph wait on the open-glyph refactor's `drawnGlyph` read.
 */
export class InteractionProbes {
  readonly #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  /**
   * A page position where the canvas hit-tests the selected component, searched on a grid
   * inside its bounds; throws when no component is selected or none of the grid hits it.
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
   * Canvas-local positions on the open glyph as the canvas draws it now, interpolated where the
   * location is between sources: its first point, the middle of its first segment, and empty
   * canvas 15px below the glyph's descender at half its advance.
   */
  glyphClickTargets(): Point2D[] {
    const editor = this.#editor;
    const node = editor.scene.first("glyph")!;
    const glyph = editor.glyphForId(node.glyphId)!;
    const geometry = glyph.geometryAt(editor.externalLocation);
    const point = geometry.allPoints[0]!;
    const segment = geometry.segments[0]!.pointAt(0.5);
    const view = glyph.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell);
    const metrics = editor.font.metricsAtLocation(editor.externalLocation);
    return [
      point,
      segment,
      {
        x: view.xAdvanceCell.peek() / 2,
        y: metrics.descender - editor.camera.screenToSceneDistance(15),
      },
    ].map((target) => editor.sceneToScreen(editor.toScene(node, target as LocalPoint)));
  }

  /**
   * Dispatches a Ctrl-wheel zoom and then a modifier-free horizontal wheel sample at the canvas
   * centre in one synchronous task, so their timestamps rather than round trips decide whether
   * the second sample continues the zoom gesture.
   *
   * @returns the pan after the zoom, the pan after the second sample, and the page time of the zoom.
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


  /** Whether the editor tracks a pointer over the canvas (or one it has captured). */
  hasCanvasPointer(): boolean {
    return this.#editor.input.pointer !== null;
  }

  /** The kind of the first selected object (`point`, `segment`, `contour`, …), or null. */
  selectedObjectKind(): string | null {
    const editor = this.#editor;
    const [id] = editor.selection.ids;
    return id ? (editor.object(id)?.kind ?? null) : null;
  }

  /** The selected draft the Shape tool publishes while its gesture is in flight. */
  liveShapeDraft(): ShapeDraft {
    const editor = this.#editor;
    const id = editor.selection.ids[0];
    const object = editor.object(id);
    if (object?.kind !== "contour") throw new Error("Expected a selected draft contour");
    const contour = object.geometry.contour(object.contourId)!;
    const bounds = editor.selectionBounds()!;
    return {
      id,
      bounds: {
        x: bounds.min.x,
        y: bounds.min.y,
        width: bounds.max.x - bounds.min.x,
        height: bounds.max.y - bounds.min.y,
      },
      points: contour.points.length,
      handles: editor.handlesVisible(contour.id),
    };
  }

  /** Whether the canvas text run is ready to draw; null without a text run. */
  canvasTextReadiness(): TextRunReadiness | null {
    const editor = this.#editor;
    const run = editor.scene.first("textRun");
    const items = run ? editor.text.run(run.runId)?.items : null;
    const layout = run ? editor.text.layoutCell(run.runId).peek() : null;
    if (!items || !layout) return null;

    return {
      codepoints: items.map((item) => (item.kind === "character" ? item.codepoint : 10)),
      editingNodes: editor.editing.nodeIds.length,
      caretAtEnd: editor.textEditing.state?.focus === items[items.length - 1]?.id,
      glyphsLoaded: layout.lines.every((line) =>
        line.runs.every((part) =>
          part.glyphs.every((glyph) => glyph.glyphId && editor.glyphForId(glyph.glyphId)),
        ),
      ),
    };
  }

  /** The canvas-local position of the middle of the open glyph's first segment. */
  firstSegmentMidpoint(): Point2D {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    if (!node) throw new Error("Expected glyph node");
    const layer = editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId);
    const segment = layer?.contours[0]?.segments()[0];
    if (!segment) throw new Error("Expected segment");

    return editor.sceneToScreen(editor.toScene(node, segment.pointAt(0.5) as LocalPoint));
  }

  /** The first line segment of the open glyph's first contour, as Cmd-hover would upgrade it. */
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

  /** What the Select tool's segment upgrade preview draws; null when no preview is rendered. */
  upgradePreviewHandles(): unknown {
    return this.#editor.toolIf("select")?.upgradePreview.propsSnapshot() ?? null;
  }

  /** The two control points of the cubic segment `segmentId`; throws when it is not a cubic. */
  cubicSegmentControls(segmentId: SegmentId): Point2D[] {
    const object = this.#editor.object(segmentId);
    if (object?.kind !== "segment") throw new Error("Expected upgraded segment");
    const cubic = object.layer?.segment(segmentId)?.asCubic();
    if (!cubic) throw new Error("Expected cubic segment");
    return [cubic.controlStart, cubic.controlEnd].map(({ x, y }) => ({ x, y }));
  }

  /**
   * The canvas-local position inside one half of the text run's spacing gap `gapIndex`, at
   * `height` of the line's height from its top (0.5 is the middle, where the value pill sits).
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

  /** The open glyph's right sidebearing at the active source, in whole units; null without one. */
  activeRightSidebearing(): number | null {
    const editor = this.#editor;
    const sourceId = editor.activeSourceId;
    const node = editor.scene.first("glyph");
    const rsb =
      node && sourceId
        ? editor.glyphForId(node.glyphId)?.layerForSource(sourceId)?.sidebearings.rsb
        : null;
    return rsb === null || rsb === undefined ? null : Math.round(rsb);
  }






  /** How many points the open glyph draws at the editor's location, interpolated between sources. */
  drawnPointCount(): number {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    if (!node) return 0;

    const geometry = editor.glyphForId(node.glyphId)?.geometryAt(editor.externalLocation);
    return geometry?.allPoints.length ?? 0;
  }

  /** How many components the open glyph draws at the editor's location, interpolated between sources. */
  drawnComponentCount(): number {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    const glyph = node ? editor.glyphForId(node.glyphId) : null;
    if (!glyph) throw new Error("Expected a loaded open glyph");

    return glyph.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell).components
      .length;
  }

  /**
   * The direct components the canvas draws for the glyph named `glyphName` at the editor's
   * location beside those its layer at the source named `sourceName` holds.
   */
  drawnAndAuthoredComponents(glyphName: string, sourceName: string): DrawnAndAuthoredComponents {
    const editor = this.#editor;
    const record = editor.font.recordForName(glyphName as GlyphName);
    if (!record) throw new Error(`Expected ${glyphName} fixture glyph`);
    const source = editor.font.sourceNamed(sourceName);
    if (!source) throw new Error(`Expected ${sourceName} fixture source`);
    const glyph = editor.glyphForId(record.id);
    if (!glyph) throw new Error(`Expected loaded ${glyphName} glyph`);

    const renderModel = glyph.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell);
    const exactGeometry = glyph.geometryForSource(source.id);
    const directComponents = renderModel.components.filter(
      (component) => component.parentPath.length === 0,
    );
    const matrixValues = (matrix: MatModel) => [
      matrix.a,
      matrix.b,
      matrix.c,
      matrix.d,
      matrix.e,
      matrix.f,
    ];

    return {
      renderedIds: directComponents.map((component) => component.componentId),
      exactIds: exactGeometry.components.map((component) => component.id),
      renderedTransforms: directComponents.map((component) => matrixValues(component.transform)),
      exactTransforms: exactGeometry.components.map((component) => matrixValues(component.matrix)),
    };
  }





  /**
   * Canvas-local positions over the canvas text run's glyphs 2 to 40 that hit-test as text and
   * lie inside a canvas of `size`, each with the text item it hits.
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

  /** How many items the canvas text run has once every glyph it lays out is loaded; null before. */
  loadedTextRunLength(): number | null {
    const editor = this.#editor;
    const run = editor.scene.first("textRun");
    const items = run ? editor.text.run(run.runId)?.items : null;
    const layout = run ? editor.text.layoutCell(run.runId).peek() : null;
    const loaded = layout?.placedGlyphs.every(
      (placed) => placed.glyph.glyphId && editor.glyphForId(placed.glyph.glyphId),
    );
    return items && loaded ? items.length : null;
  }

  /**
   * The live position of the `u` glyph's `top` anchor in its default-source layer, a drag's
   * uncommitted preview included.
   */
  liveUTopAnchor(): LocalPoint {
    const editor = this.#editor;
    const record = editor.font.recordForName("u" as GlyphName);
    const layer = record
      ? editor.glyphForId(record.id)?.layerForSource(editor.font.defaultSource.id)
      : null;
    const anchor = layer?.anchors.find((candidate) => candidate.name === "top");
    if (!anchor) throw new Error("Expected u's top anchor");

    return localPoint(anchor.x, anchor.y);
  }
  /** Delivers the latest coalesced pointer move to the active tool, as the next frame would. */
  flushPointerMoves(): void {
    this.#editor.toolManager.flushPointerMoves();
  }
  /** Pans the canvas to `offset`, in screen pixels, as the Hand tool does. */
  setPan(offset: Point2D): void {
    this.#editor.setPan(offset);
  }
  /** Clears the selection without a key or pointer event, as an undo or agent edit can. */
  clearSelection(): void {
    this.#editor.selection.clear();
  }
  /**
   * Moves the open glyph's placement to (200, -300), zooms in one step, and pastes an open
   * contour of four points across the canvas's vertical middle, two of them just past its left
   * and right edges and one 2px inside the left edge.
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
