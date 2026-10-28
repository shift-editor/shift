import type { Page } from "@playwright/test";
import type { LocalPoint, ScenePoint, ScreenPoint } from "@shift/editor/spaces";
import type { ExternalAxisLocation } from "@shift/editor/types";
import type { MatModel, Point2D } from "@shift/geo";
import type {
  GlyphName,
  PointId,
  SegmentId,
  SelectableId,
  SourceId,
  TextItemId,
} from "@shift/types";

/**
 * A page position where the canvas hit-tests the selected component, searched on a grid
 * inside its bounds; throws when no component is selected or none of the grid hits it.
 */
export async function selectedComponentHitPoint(page: Page): Promise<Point2D> {
  return page.evaluate(() => {
    const editor = window.shift!.editor;
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
  });
}

/**
 * Canvas-local positions on the open glyph as the canvas draws it now, interpolated where the
 * location is between sources: its first point, the middle of its first segment, and empty
 * canvas 15px below the glyph's descender at half its advance.
 */
export async function glyphClickTargets(page: Page): Promise<Point2D[]> {
  return page.evaluate(() => {
    const editor = window.shiftSession!.editor;
    const node = editor.scene.nodesOfKind("glyph")[0]!;
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
    ].map((point) => editor.sceneToScreen(editor.toScene(node, point as LocalPoint)));
  });
}

/**
 * Dispatches a Ctrl-wheel zoom and then a modifier-free horizontal wheel sample at the canvas
 * centre in one synchronous page task, so their timestamps rather than Playwright round trips
 * decide whether the second sample continues the zoom gesture.
 *
 * @returns the pan after the zoom, the pan after the second sample, and the page time of the zoom.
 */
export async function wheelZoomThenPan(
  page: Page,
): Promise<{ zoomPan: Point2D; momentumPan: Point2D; zoomedAt: number }> {
  return page.evaluate(() => {
    const editor = window.shift?.editor;
    const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
    if (!editor || !canvas) throw new Error("Expected editor canvas");

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
  });
}

/** Waits until the page clock (`performance.now()`) is more than `ms` past `since`. */
export async function waitForPageClock(page: Page, since: number, ms: number): Promise<void> {
  await page.waitForFunction(({ start, elapsed }) => performance.now() - start > elapsed, {
    start: since,
    elapsed: ms,
  });
}

/** Sets the canvas zoom level, as the zoom menu does. */
export async function setZoom(page: Page, zoom: number): Promise<void> {
  await page.evaluate((value) => window.shift!.editor.setZoom(value), zoom);
}

/** Pans the canvas to `offset`, in screen pixels, as the Hand tool does. */
export async function setCanvasOffset(page: Page, offset: Point2D): Promise<void> {
  await page.evaluate((pan) => window.shift!.editor.setPan(pan), offset);
}

/** Clears the selection without a key or pointer event, as an undo or agent edit can. */
export async function clearSelection(page: Page): Promise<void> {
  await page.evaluate(() => window.shift!.editor.selection.clear());
}

/** Whether the editor tracks a pointer over the canvas (or one it has captured). */
export async function hasCanvasPointer(page: Page): Promise<boolean> {
  return page.evaluate(() => (window.shift?.editor.input.pointer ?? null) !== null);
}

/** The kind of the first selected object (`point`, `segment`, `contour`, …), or null. */
export async function selectedObjectKind(page: Page): Promise<string | null | undefined> {
  return page.evaluate(() => {
    const editor = window.shift?.editor;
    const [id] = editor?.selection.ids ?? [];
    return id ? editor?.object(id)?.kind : null;
  });
}

/**
 * The selected live shape draft the Shape tool publishes while its gesture is in flight: its
 * contour's selection id, selection bounds in glyph units, point count, and whether its handles
 * are drawn.
 */
export async function liveShapeDraft(page: Page): Promise<{
  id: string | undefined;
  bounds: { x: number; y: number; width: number; height: number };
  points: number;
  handles: boolean;
}> {
  return page.evaluate(() => {
    const editor = window.shift!.editor;
    const id = editor.selection.ids[0];
    const object = editor.object(id);
    if (object?.kind !== "contour") throw new Error("Expected a selected draft contour");
    const contour = object.geometry.contour(object.contourId)!;
    return {
      id,
      bounds: (() => {
        const b = editor.selectionBounds()!;
        return { x: b.min.x, y: b.min.y, width: b.max.x - b.min.x, height: b.max.y - b.min.y };
      })(),
      points: contour.points.length,
      handles: editor.handlesVisible(contour.id),
    };
  });
}

/**
 * Whether the canvas text run is ready to draw: its items' codepoints (10 for anything but a
 * character), how many nodes are being edited, whether the caret sits after the last item, and
 * whether every glyph it lays out is loaded; null without a text run.
 */
export async function canvasTextReadiness(page: Page): Promise<{
  codepoints: number[];
  editingNodes: number;
  caretAtEnd: boolean;
  glyphsLoaded: boolean;
} | null> {
  return page.evaluate(() => {
    const editor = window.shift!.editor;
    const run = editor.scene.nodesOfKind("textRun")[0];
    const items = run ? editor.text.run(run.runId)?.items : null;
    const layout = run ? editor.text.layoutCell(run.runId).peek() : null;
    return items && layout
      ? {
          codepoints: items.map((item) => (item.kind === "character" ? item.codepoint : 10)),
          editingNodes: editor.editing.nodeIds.length,
          caretAtEnd: editor.textEditing.state?.focus === items[items.length - 1]?.id,
          glyphsLoaded: layout.lines.every((line) =>
            line.runs.every((part) =>
              part.glyphs.every((glyph) => glyph.glyphId && editor.glyphForId(glyph.glyphId)),
            ),
          ),
        }
      : null;
  });
}

/** The canvas-local position of the middle of the open glyph's first segment. */
export async function firstSegmentMidpoint(page: Page): Promise<Point2D> {
  return page.evaluate(() => {
    const editor = window.shift!.editor;
    const node = editor.scene.nodesOfKind("glyph")[0];
    if (!node) throw new Error("Expected glyph node");
    const layer = editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId);
    const segment = layer?.contours[0]?.segments()[0];
    if (!segment) throw new Error("Expected segment");
    const point = segment.pointAt(0.5);

    return editor.sceneToScreen(editor.toScene(node, point as LocalPoint));
  });
}

/**
 * The first line segment of the open glyph's first contour, as Cmd-hover would upgrade it: its
 * id, the control points an upgrade places at one and two thirds (glyph units and scene), and
 * the canvas-local position of its middle.
 */
export async function lineSegmentUpgrade(page: Page): Promise<{
  id: SegmentId;
  controls: Point2D[];
  sceneControls: Point2D[];
  hover: Point2D;
}> {
  return page.evaluate(() => {
    const editor = window.shift!.editor;
    const node = editor.scene.nodesOfKind("glyph")[0];
    const layer = editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!;
    const segment = layer.contours[0].segments().find((segment) => segment.type === "line");
    if (!segment) throw new Error("Expected line segment");
    const middle = segment.pointAt(1 / 2);
    return {
      id: segment.id,
      controls: [1 / 3, 2 / 3].map((t) => segment.pointAt(t)),
      sceneControls: [1 / 3, 2 / 3].map((t) => {
        return editor.toScene(node, segment.pointAt(t) as LocalPoint);
      }),
      hover: editor.sceneToScreen(editor.toScene(node, { x: middle.x, y: middle.y } as LocalPoint)),
    };
  });
}

/**
 * The scene positions the Select tool's segment upgrade preview draws; null when no preview is
 * rendered.
 */
export async function upgradePreviewHandles(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const tool = window.shift?.editor.toolManager.activeTool;
    if (tool?.id !== "select" || !("upgradePreview" in tool)) return null;

    const preview = tool.upgradePreview as { propsSnapshot(): unknown };
    return preview.propsSnapshot() ?? null;
  });
}

/** The two control points of the cubic segment `segmentId`; throws when it is not a cubic. */
export async function cubicSegmentControls(page: Page, segmentId: SegmentId): Promise<Point2D[]> {
  return page.evaluate((id) => {
    const object = window.shift!.editor.object(id);
    if (object?.kind !== "segment") throw new Error("Expected upgraded segment");
    const cubic = object.layer?.segment(id)?.asCubic();
    if (!cubic) throw new Error("Expected cubic segment");
    return [cubic.controlStart, cubic.controlEnd].map(({ x, y }) => ({ x, y }));
  }, segmentId);
}

/**
 * Moves the open glyph's placement to (200, -300), zooms in one step, and inserts an open
 * contour of four points across the canvas's vertical middle, two of them just past its left
 * and right edges and one 2px inside the left edge.
 */
export async function insertEdgeOverlappingContour(page: Page): Promise<void> {
  await page.evaluate(() => {
    const editor = window.shift!.editor;
    const node = editor.scene.nodesOfKind("glyph")[0]!;
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
            const scene = editor.screenToScene({
              x,
              y: camera.logicalHeight / 2,
            } as ScreenPoint);
            const local = editor.toLocal(placed, scene);
            return {
              x: local.x,
              y: local.y,
              pointType: "onCurve" as const,
              smooth: false,
            };
          }),
        },
      ],
    });
    if (!inserted) throw new Error("Expected inserted points");
  });
}

/**
 * The canvas-local position inside one half of the text run's spacing gap `gapIndex`, at
 * `height` of the line's height from its top (0.5 is the middle, where the value pill sits).
 */
export async function spacingHalfCanvasPoint(
  page: Page,
  gapIndex: number,
  side: "left" | "right",
  height: number,
): Promise<Point2D> {
  return page.evaluate(
    ({ gapIndex, side, height }) => {
      const editor = window.shift!.editor;
      const run = editor.scene.nodesOfKind("textRun")[0]!;
      const gap = editor.nodeDefinition("textRun").spacingGaps(run)[gapIndex]!;
      const half = gap[side]!;
      const point = {
        x: (half.edge + (side === "left" ? gap.leftBoundary : gap.rightBoundary)) / 2,
        y: gap.top + (gap.bottom - gap.top) * height,
      };
      return editor.sceneToScreen(editor.toScene(run, point as never));
    },
    { gapIndex, side, height },
  );
}

/** The edited glyph's right sidebearing at the active source, in whole units; null without one. */
export async function activeRightSidebearing(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const editor = window.shift!.editor;
    const sourceId = editor.activeSourceId;
    const node = editor.scene.nodesOfKind("glyph")[0];
    const rsb =
      node && sourceId
        ? editor.glyphForId(node.glyphId)?.layerForSource(sourceId)?.sidebearings.rsb
        : null;
    return rsb === null || rsb === undefined ? null : Math.round(rsb);
  });
}

/**
 * The open glyph's points as its layer holds them now, a gesture's preview included, without
 * waiting for edits to settle.
 */
export async function livePoints(page: Page): Promise<{ id: PointId; x: number; y: number }[]> {
  return page.evaluate(() => {
    const editor = window.shift!.editor;
    const node = editor.scene.nodesOfKind("glyph")[0]!;
    const layer = editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!;
    return layer.allPoints.map((point) => ({ id: point.id, x: point.x, y: point.y }));
  });
}

/** Where the Pen's in-flight drag places the outgoing handle, in glyph units; throws outside a drag. */
export async function penDragHandle(page: Page): Promise<Point2D> {
  return page.evaluate(() => {
    const state = window.shift!.editor.toolIf("pen")?.state;
    if (state?.type !== "dragging") throw new Error("Expected Pen drag");
    return state.curve.handlePosition;
  });
}

/**
 * Where a Shift-constrained Pen drag from canvas-local `down` to `end` places its points in the
 * open glyph: the anchor at `down`, and the incoming and outgoing handles snapped to 30 degrees
 * at the pointer's distance.
 */
export async function penSnapExpectation(
  page: Page,
  down: Point2D,
  end: Point2D,
): Promise<{ anchor: Point2D; incoming: Point2D; outgoing: Point2D }> {
  return page.evaluate(
    ({ down, end }) => {
      const editor = window.shift!.editor;
      const node = editor.scene.nodesOfKind("glyph")[0]!;
      const anchor = editor.toLocal(node, editor.screenToScene(down as ScreenPoint));
      const pointer = editor.toLocal(node, editor.screenToScene(end as ScreenPoint));
      const length = Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y);
      return {
        anchor,
        incoming: {
          x: anchor.x - length * Math.cos(Math.PI / 6),
          y: anchor.y - length * Math.sin(Math.PI / 6),
        },
        outgoing: {
          x: anchor.x + length * Math.cos(Math.PI / 6),
          y: anchor.y + length * Math.sin(Math.PI / 6),
        },
      };
    },
    { down, end },
  );
}

/**
 * A drag of the first segment's outgoing handle to glyph position (180, 160), in whole canvas
 * pixels, and where a Shift-constrained drag must leave it: snapped to 30 degrees around the
 * segment's start at the dragged length.
 */
export async function handleSnapDrag(page: Page): Promise<{
  id: PointId;
  pivot: PointId;
  down: Point2D;
  end: Point2D;
  expected: Point2D;
}> {
  return page.evaluate(() => {
    const editor = window.shift!.editor;
    const node = editor.scene.nodesOfKind("glyph")[0]!;
    const layer = editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!;
    const cubic = layer.contours[0]!.segments()[0]!.asCubic()!;
    const down = editor.sceneToScreen(
      editor.toScene(node, { x: cubic.controlStart.x, y: cubic.controlStart.y } as LocalPoint),
    );
    const end = editor.sceneToScreen(editor.toScene(node, { x: 180, y: 160 } as LocalPoint));
    down.x = Math.round(down.x);
    down.y = Math.round(down.y);
    end.x = Math.round(end.x);
    end.y = Math.round(end.y);
    const startPos = editor.screenToScene(down);
    const endPos = editor.screenToScene(end);
    const length = Math.hypot(
      cubic.controlStart.x + endPos.x - startPos.x - cubic.start.x,
      cubic.controlStart.y + endPos.y - startPos.y - cubic.start.y,
    );
    return {
      id: cubic.controlStart.id,
      pivot: cubic.start.id,
      down,
      end,
      expected: {
        x: cubic.start.x + length * Math.cos(Math.PI / 6),
        y: cubic.start.y + length * Math.sin(Math.PI / 6),
      },
    };
  });
}

/** The id of the font's first named instance that no source sits exactly at, or null. */
export async function instanceBetweenSources(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const font = window.shiftSession!.font;
    return (
      font.namedInstances.find(
        (instance) =>
          !font.sourceAt(
            new Map(
              font
                .getAxes()
                .map((axis) => [axis.id, instance.location.values[axis.id] ?? axis.default]),
            ) as unknown as ExternalAxisLocation,
          ),
      )?.id ?? null
    );
  });
}

/** How many points the open glyph draws at the editor's location, interpolated between sources. */
export async function drawnPointCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const editor = window.shiftSession!.editor;
    const node = editor.scene.nodesOfKind("glyph")[0];
    if (!node) return 0;

    const geometry = editor.glyphForId(node.glyphId)?.geometryAt(editor.externalLocation);
    return geometry?.allPoints.length ?? 0;
  });
}

/** How many components the open glyph draws at the editor's location, interpolated between sources. */
export async function drawnComponentCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const { editor } = window.shift!;
    const node = editor.scene.nodesOfKind("glyph")[0];
    const glyph = node ? editor.glyphForId(node.glyphId) : null;
    if (!glyph) throw new Error("Expected loaded Aacute glyph");

    return glyph.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell).components
      .length;
  });
}

/**
 * The direct components the canvas draws for the glyph named `glyphName` at the editor's
 * location beside those its layer at the source named `sourceName` holds: their ids, and their
 * transforms as `[a, b, c, d, e, f]`.
 */
export async function drawnAndAuthoredComponents(
  page: Page,
  glyphName: string,
  sourceName: string,
): Promise<{
  renderedIds: string[];
  exactIds: string[];
  renderedTransforms: number[][];
  exactTransforms: number[][];
}> {
  return page.evaluate(
    ({ glyphName, sourceName }) => {
      const workspace = window.shift;
      if (!workspace) throw new Error("Expected workspace");

      const record = workspace.font.recordForName(glyphName);
      if (!record) throw new Error(`Expected ${glyphName} fixture glyph`);
      const source = workspace.font.sources.find((candidate) => candidate.name === sourceName);
      if (!source) throw new Error(`Expected ${sourceName} fixture source`);
      const glyph = workspace.editor.glyphForId(record.id);
      if (!glyph) throw new Error(`Expected loaded ${glyphName} glyph`);

      const renderModel = glyph.renderModelAt(
        workspace.editor.externalLocationCell,
        workspace.editor.activeSourceIdCell,
      );
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
        exactTransforms: exactGeometry.components.map((component) =>
          matrixValues(component.matrix),
        ),
      };
    },
    { glyphName, sourceName },
  );
}

/** How many other sources' layers the editing selection has matched to the active layer. */
export async function editingLayerMatchCount(page: Page): Promise<number> {
  return page.evaluate(() => window.shiftSession!.editor.editingLayerMatchesCell.peek().size);
}

/**
 * The point the editing selection's one layer match pairs with the active layer's point
 * `referencePointId`: its layer, id, and position there; throws without a complete match.
 */
export async function matchedEditingPoint(
  page: Page,
  referencePointId: PointId,
): Promise<{ layerId: string; pointId: PointId; position: Point2D }> {
  return page.evaluate((referenceId) => {
    const session = window.shiftSession!;
    const [layerMatch] = session.editor.editingLayerMatchesCell.peek().values();
    if (!layerMatch?.complete) throw new Error("Expected complete layer match");
    const targetPointId = layerMatch.points.find(
      (match) => match.referenceId === referenceId,
    )?.targetId;
    const node = session.editor.scene.nodesOfKind("glyph")[0];
    const targetLayer = node
      ? session.editor.glyphForId(node.glyphId)?.layerForId(layerMatch.targetLayerId)
      : null;
    const point = targetPointId ? targetLayer?.point(targetPointId) : null;
    if (!targetPointId || !point) throw new Error("Expected matched target point");

    return {
      layerId: layerMatch.targetLayerId,
      pointId: targetPointId,
      position: { x: point.x, y: point.y },
    };
  }, referencePointId);
}

/** Selects the objects `ids`, replacing the selection, as clicking them in the Objects tab does. */
export async function selectObjects(page: Page, ids: readonly SelectableId[]): Promise<void> {
  await page.evaluate((selected) => window.shift!.editor.selection.select(selected), ids);
}

/** Fits the open glyph in the canvas, as View › Zoom to Fit does. */
export async function zoomToFit(page: Page): Promise<void> {
  await page.evaluate(() => window.shift!.editor.zoomToFit());
}

/**
 * Selects sources for editing in one page task, in order, as clicking their rows in the Sources
 * panel does: alone each source becomes the active one; with `toggle` it joins or leaves the
 * editing selection.
 */
export async function selectSourcesForEditing(
  page: Page,
  steps: readonly { sourceId: SourceId; mode?: "toggle" }[],
): Promise<void> {
  await page.evaluate((selections) => {
    const runtime = window.shift!.editor;
    for (const { sourceId, mode } of selections) {
      if (mode === undefined) runtime.selectSourceForEditing(sourceId);
      else runtime.selectSourceForEditing(sourceId, mode);
    }
  }, steps);
}

/** How many other sources' layers an edit of the points `ids` also moves. */
export async function matchedSourceLayerCount(
  page: Page,
  ids: readonly PointId[],
): Promise<number | undefined> {
  return page.evaluate(
    (pointIds) => window.shift!.editor.positionSelection(pointIds)?.additionalLayers.length,
    ids,
  );
}

/**
 * Where an edit of the points `ids` finds its first point in each layer it moves: the active
 * layer first, then each other editing source's matched layer; throws when a layer has no
 * matched point.
 */
export async function matchedFirstPointPositions(
  page: Page,
  ids: readonly PointId[],
): Promise<Point2D[]> {
  return page.evaluate((pointIds) => {
    const selection = window.shift!.editor.positionSelection(pointIds);
    if (!selection) throw new Error("Expected an editable selection");
    const groups = [selection, ...selection.additionalLayers];
    return groups.map(({ layer, targets }) => {
      const id = targets.points?.[0];
      if (!id) throw new Error("Expected a matched point in each source");
      const point = layer.point(id);
      if (!point) throw new Error("Expected editable point geometry");
      return { x: point.x, y: point.y };
    });
  }, ids);
}

/**
 * Canvas-local positions over the canvas text run's glyphs 2 to 40 that hit-test as text and lie
 * inside a canvas of `size`, each with the text item it hits.
 */
export async function textRunHoverTargets(
  page: Page,
  size: { width: number; height: number },
): Promise<{ itemId: TextItemId; position: Point2D }[]> {
  return page.evaluate((canvas) => {
    const editor = window.shift!.editor;
    const run = editor.scene.nodesOfKind("textRun")[0];
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
        screen.x > 0 && screen.y > 0 && screen.x < canvas.width && screen.y < canvas.height;
      if (target.kind === "text" && onCanvas)
        found.push({ itemId: target.itemId, position: screen });
    }
    return found;
  }, size);
}

/** How many items the canvas text run has once every glyph it lays out is loaded; null before. */
export async function loadedTextRunLength(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const editor = window.shift!.editor;
    const run = editor.scene.nodesOfKind("textRun")[0];
    const items = run ? editor.text.run(run.runId)?.items : null;
    const layout = run ? editor.text.layoutCell(run.runId).peek() : null;
    const loaded = layout?.placedGlyphs.every(
      (placed) => placed.glyph.glyphId && editor.glyphForId(placed.glyph.glyphId),
    );
    return items && loaded ? items.length : null;
  });
}

/**
 * The live position of the `u` glyph's `top` anchor in its default-source layer, a drag's
 * uncommitted preview included, without waiting for edits to settle.
 */
export async function liveUTopAnchor(page: Page): Promise<Point2D> {
  return page.evaluate(() => {
    const editor = window.shift!.editor;
    const record = editor.font.recordForName("u" as GlyphName);
    const layer = record
      ? editor.glyphForId(record.id)?.layerForSource(editor.font.defaultSource.id)
      : null;
    const anchor = layer?.anchors.find((candidate) => candidate.name === "top");
    if (!anchor) throw new Error("Expected u's top anchor");

    return { x: anchor.x, y: anchor.y };
  });
}
