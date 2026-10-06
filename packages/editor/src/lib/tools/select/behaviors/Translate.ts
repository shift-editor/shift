import { Bounds, Mat, type Point2D } from "@shift/geo";
import { Point, type Contour, type Segment } from "@shift/glyph-state";
import type { PointId, ShiftId } from "@shift/types";

import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "../../../editor/Editor";
import type { GlyphLayer, GlyphLayerPositionTarget } from "../../../model/Glyph";
import type { DragEvent, DragStartEvent, ToolEvent } from "../../core/GestureDetector";
import { DirectionSnap, PositionReference } from "../../../model/positions";
import { scenePoint, vectorBetween } from "../../../editor/spaces";
import { objectIsKindOf, type ShiftObjectOf } from "../../../../types/object";
import type { PointerTarget } from "../../../../types/target";
import type { PositionCondition } from "../../../../types/positionEdit";
import type { TransformEdit } from "../../../../types/transformTarget";
import type { SelectBehavior, SelectState } from "../types";
import type { Select } from "../Select";
import { TranslateInteraction } from "../TranslateInteraction";
import { pointSlide } from "../PointSlide";
import { EndpointDrop } from "../EndpointDrop";

type TranslatingState = Extract<SelectState, { type: "translating" }>;

export class Translate implements SelectBehavior {
  #drag: TranslateInteraction | null = null;
  #transformEdit: TransformEdit | null = null;
  #done: (() => void) | null = null;

  onDragStart(
    state: SelectState,
    ctx: ToolContext<SelectState, Select>,
    event: DragStartEvent,
  ): boolean {
    if (state.type !== "idle" && state.type !== "ready") return false;

    const transformEdit = this.#fromTransformDragStart(ctx.editor, ctx.tool, event);
    const drag = transformEdit ? null : this.#fromDragStart(ctx.editor, ctx.tool, event);
    if (!drag && !transformEdit) return false;

    this.#drag = drag;
    this.#transformEdit = transformEdit;
    this.#done = ctx.onCancel(() => {
      drag?.discard();
      transformEdit?.discard();
    });
    ctx.setState(translatingState(event.origin.scene, event.shiftKey, event.accelKey));

    if (drag && !event.altKey) {
      this.#configureDirectionSnap(ctx.editor, ctx.tool, drag);
      this.#configurePositionSnap(ctx.editor, ctx.tool, drag);
    }

    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState>, event: DragEvent): boolean {
    if (state.type !== "translating") return false;
    if (!this.#drag && !this.#transformEdit) return false;

    const nextState = this.#nextTranslatingState(state, event);
    ctx.setState(nextState);
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "translating") return false;

    this.#commitDrag(ctx.editor);
    this.#transformEdit?.commit();
    if (this.#done) this.#done();

    this.#cleanup();
    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "translating") return false;
    this.#cleanup();
    ctx.setState({ type: "ready" });
    return true;
  }

  onStateEnter(
    prev: SelectState,
    next: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEvent,
  ): void {
    if (next.type !== "translating") return;
    if (prev.type !== "translating") ctx.editor.hover.clear();
    if (event.type !== "drag") return;

    const node = ctx.editor.selectionNode();
    if (!node) return;

    const { startPos, lastPos } = next.translate;
    const sceneDelta = vectorBetween(
      scenePoint(startPos.x, startPos.y),
      scenePoint(lastPos.x, lastPos.y),
    );
    const delta = ctx.editor.toLocalVector(node, sceneDelta);
    if (this.#transformEdit) {
      this.#transformEdit.preview(() => Mat.Translate(delta.x, delta.y));
      ctx.setState({
        ...next,
        translate: { ...next.translate, totalDelta: delta, guides: [] },
      });
      return;
    }
    if (!this.#drag) return;

    const feedback = this.#drag.preview(delta);
    ctx.setState({
      ...next,
      translate: {
        ...next.translate,
        totalDelta: feedback.delta,
        guides: feedback.guides,
      },
    });
  }

  #configureDirectionSnap(editor: Editor, select: Select, drag: TranslateInteraction): void {
    const objects = editor.objects(editor.selection.ids);
    const condition: PositionCondition = {
      when: () => {
        const state = select.getState();
        return state.type === "translating" && state.translate.shiftKey;
      },
    };
    const object = objects[0];

    if (objects.length === 1 && objectIsKindOf(object, "point")) {
      const pivot = this.#pointSnapPivot(object);
      if (!pivot) return;

      drag.move
        .from(PositionReference.point(object.id))
        .directionSnappedBy(DirectionSnap.everyDegrees(15, condition).around(pivot));
      return;
    }

    const segments: Segment[] = [];
    for (const object of objects) {
      switch (object.kind) {
        case "segment": {
          const segment = object.geometry.segment(object.segmentId);
          if (!segment) return;

          segments.push(segment);
          break;
        }
        case "point":
          break;
        default:
          return;
      }
    }

    if (segments.length === 0) return;

    // Direct segment drags also select their constituent point identities.
    const pointIds = new Set(segments.flatMap((segment) => segment.pointIds));
    if (objects.some((object) => object.kind === "point" && !pointIds.has(object.id))) return;

    const centre = this.#segmentSnapCentre(segments);
    if (!centre) return;

    drag.move
      .from(centre)
      .directionSnappedBy(DirectionSnap.everyDegrees(90, condition).around(centre).withoutGuides());
  }

  /** Snaps dragged points to source metrics and into line with on-screen points that stay put. */
  #configurePositionSnap(editor: Editor, select: Select, drag: TranslateInteraction): void {
    const { layer, targets } = drag.selection;
    const moving = targets.points ?? [];
    const candidates = snapCandidates(layer, moving);
    if (candidates.length === 0) return;

    const condition: PositionCondition = {
      when: () => {
        const state = select.getState();
        return state.type === "translating" && !state.translate.accelKey;
      },
    };
    // A group never aligns with its own edges, but their ends are still marked on a snap line.
    const movingIds = new Set(moving);
    const neighbours =
      candidates.length > 1 ? edgeNeighbours(layer, movingIds) : new Set<PointId>();
    const excluding = new Set([...movingIds, ...neighbours]);
    drag.move.snappedBy(
      editor.snapping.forLayer(layer, editor.selectionNode(), {
        excluding,
        marking: neighbours,
        condition,
      }),
      candidates.map((pointId) => PositionReference.point(pointId)),
    );
  }

  #pointSnapPivot(object: ShiftObjectOf<"point">): PositionReference | null {
    if (!object.layer) return null;

    const point = object.geometry.point(object.pointId);
    const contour = object.geometry.contour(object.contourId);
    if (!point || !contour) return null;

    const segments = contour.segments();
    if (Point.isOnCurve(point)) {
      const incoming = segments.find((segment) => segment.endId === point.id);
      const outgoing = segments.find((segment) => segment.startId === point.id);
      const self = PositionReference.point(point.id);

      if (incoming?.type === "line" && outgoing?.type === "line") return self;
      if (outgoing?.type === "line") return PositionReference.point(outgoing.endId);
      if (!contour.closed && !outgoing && incoming?.type === "line") {
        return PositionReference.point(incoming.startId);
      }

      return self;
    }

    // A smooth junction's line fixes this handle's direction; there is no angle to snap.
    if (handleFollowsLine(contour, point)) return null;

    const anchor = contour.cubicHandleAnchor(point.id);
    return anchor ? PositionReference.point(anchor.id) : null;
  }

  #segmentSnapCentre(segments: readonly Segment[]): PositionReference | null {
    const bounds = Bounds.unionAll(segments.map((segment) => segment.bounds));
    if (!bounds) return null;

    return PositionReference.position(Bounds.center(bounds));
  }

  /** Commits the move; an open end dropped on another open end also closes or joins its contour. */
  #commitDrag(editor: Editor): void {
    const drag = this.#drag;
    if (!drag) return;

    const drop = EndpointDrop.fromSelection(editor);
    const target = drop?.targetWithin(editor.hitRadius) ?? null;
    if (!drop || !target) {
      drag.commit();
      return;
    }

    if (drop.commitAndJoin(() => drag.commit(), target)) editor.selection.clear();
  }

  #cleanup(): void {
    this.#drag = null;
    this.#transformEdit = null;
    this.#done = null;
  }

  /** Moves a whole component or text glyph, selecting it first when the box does not own the drag. */
  #fromTransformDragStart(
    editor: Editor,
    select: Select,
    event: DragStartEvent,
  ): TransformEdit | null {
    switch (event.target.kind) {
      case "component":
      case "text":
        if (!boundingBoxOwnsDrag(editor, select, event)) {
          editor.selection.select([targetId(event.target)]);
        }
        break;
      case "node":
      case "canvas":
        if (!select.boundingBox.containsTranslationPoint(event.origin)) return null;
        break;
      case "point":
      case "anchor":
      case "segment":
        return null;
    }

    return editor.transformTarget()?.begin("move") ?? null;
  }

  #fromDragStart(
    editor: Editor,
    select: Select,
    event: DragStartEvent,
  ): TranslateInteraction | null {
    if (!event.altKey && boundingBoxOwnsDrag(editor, select, event)) {
      return this.#fromSelection(editor, event.origin.scene);
    }

    switch (event.target.kind) {
      case "point":
        return this.#fromPointTarget(editor, event);
      case "anchor":
        return this.#fromAnchorTarget(editor, event);
      case "segment":
        return this.#fromSegmentTarget(editor, event);
      case "component":
      case "node":
      case "text":
      case "canvas":
        return this.#fromInsideSelectionBounds(editor, select, event);
    }
  }

  #fromPointTarget(editor: Editor, event: DragStartEvent): TranslateInteraction | null {
    if (event.target.kind !== "point") return null;

    const pointId = event.target.id;
    const selectedWithOthers =
      editor.selection.isSelected(pointId) && editor.selection.ids.length > 1;
    if (event.altKey && selectedWithOthers) {
      return this.#fromDuplicatedSelection(editor, event.origin.scene);
    }
    if (event.altKey) {
      const slide = this.#fromSlidingPoint(editor, pointId, event.origin.scene);
      if (slide) return slide;
    }

    const reference = { kind: "point" as const, id: event.target.id };
    if (editor.selection.isSelected(event.target.id)) {
      return this.#fromSelection(editor, event.origin.scene, reference);
    }

    const selection = editor.positionSelection([event.target.id]);
    if (!selection) return null;

    editor.selection.select([event.target.id]);
    return new TranslateInteraction(selection, reference, event.origin.scene);
  }

  #fromSlidingPoint(
    editor: Editor,
    pointId: PointId,
    pointerStart: Point2D,
  ): TranslateInteraction | null {
    const selection = editor.positionSelection([pointId]);
    const slide = selection ? pointSlide(selection.layer, pointId) : null;
    if (!selection || !slide) return null;

    editor.selection.select([pointId]);
    return new TranslateInteraction(selection, { kind: "point", id: pointId }, pointerStart, slide);
  }

  #fromAnchorTarget(editor: Editor, event: DragStartEvent): TranslateInteraction | null {
    if (event.target.kind !== "anchor") return null;

    const reference = { kind: "anchor" as const, id: event.target.id };
    if (editor.selection.isSelected(event.target.id)) {
      return this.#fromSelection(editor, event.origin.scene, reference);
    }

    const selection = editor.positionSelection([event.target.id]);
    if (!selection) return null;

    editor.selection.select([event.target.id]);
    return new TranslateInteraction(selection, reference, event.origin.scene);
  }

  #fromSegmentTarget(editor: Editor, event: DragStartEvent): TranslateInteraction | null {
    if (event.target.kind !== "segment" || event.target.pointIds.length === 0) return null;
    if (event.altKey) return this.#fromDuplicatedSelection(editor, event.origin.scene);

    if (editor.selection.isSelected(event.target.id)) {
      return this.#fromSelection(editor, event.origin.scene);
    }

    const selection = editor.positionSelection([event.target.id]);
    const referenceId = event.target.pointIds[0];
    if (!selection || !referenceId) return null;

    editor.selection.select([event.target.id, ...event.target.pointIds]);
    return new TranslateInteraction(
      selection,
      { kind: "point", id: referenceId },
      event.origin.scene,
    );
  }

  #fromDuplicatedSelection(editor: Editor, pointerStart: Point2D): TranslateInteraction | null {
    const pointIds = editor.duplicateSelection();
    const referenceId = pointIds[0];
    if (!referenceId) return null;

    const selection = editor.positionSelection(pointIds);
    if (!selection) return null;

    editor.selection.select(pointIds);
    return new TranslateInteraction(selection, { kind: "point", id: referenceId }, pointerStart);
  }

  #fromSelection(
    editor: Editor,
    pointerStart: Point2D,
    reference: GlyphLayerPositionTarget | null = null,
  ): TranslateInteraction | null {
    const selection = editor.positionSelection(editor.selection.ids);
    if (!selection) return null;

    return new TranslateInteraction(selection, reference, pointerStart);
  }

  #fromInsideSelectionBounds(
    editor: Editor,
    select: Select,
    event: DragStartEvent,
  ): TranslateInteraction | null {
    if (!select.boundingBox.containsTranslationPoint(event.origin)) return null;

    return this.#fromSelection(editor, event.origin.scene);
  }

  #nextTranslatingState(state: TranslatingState, event: DragEvent): TranslatingState {
    const currentPos = event.coords.scene;

    return {
      type: "translating",
      translate: {
        ...state.translate,
        lastPos: currentPos,
        shiftKey: event.shiftKey,
        accelKey: event.accelKey,
      },
    };
  }
}

function translatingState(
  startPos: Point2D,
  shiftKey: boolean,
  accelKey: boolean,
): TranslatingState {
  return {
    type: "translating",
    translate: {
      shiftKey,
      accelKey,
      startPos,
      lastPos: startPos,
      totalDelta: { x: 0, y: 0 },
      guides: [],
    },
  };
}

/** Whether an unselected target sits inside the selection's bounding box, which then moves instead. */
/** The selectable identity of an object target. */
function targetId(target: Exclude<PointerTarget, { kind: "canvas" | "node" }>): ShiftId {
  return target.kind === "text" ? target.itemId : target.id;
}

function boundingBoxOwnsDrag(editor: Editor, select: Select, event: DragStartEvent): boolean {
  const { target } = event;
  const targetSelected =
    target.kind !== "canvas" &&
    target.kind !== "node" &&
    editor.selection.isSelected(targetId(target));

  return !targetSelected && select.boundingBox.containsTranslationPoint(event.origin);
}

/** A lone dragged point snaps itself; a group snaps through its on-curve corners. */
function snapCandidates(layer: GlyphLayer, pointIds: readonly PointId[]): PointId[] {
  if (pointIds.length === 1) return [...pointIds];

  return pointIds.filter((pointId) => {
    const point = layer.geometry.point(pointId);
    return point !== null && Point.isOnCurve(point);
  });
}

/**
 * Stationary points joined by a segment to a moving point: the far ends of the edges a
 * dragged group carries, whose alignment with the group it keeps on its own.
 */
function edgeNeighbours(layer: GlyphLayer, moving: ReadonlySet<PointId>): Set<PointId> {
  const neighbours = new Set<PointId>();

  for (const contour of layer.contours) {
    for (const segment of contour.segments()) {
      if (moving.has(segment.startId)) neighbours.add(segment.endId);
      if (moving.has(segment.endId)) neighbours.add(segment.startId);
    }
  }

  for (const pointId of moving) neighbours.delete(pointId);
  return neighbours;
}

/** Whether `handle` sits on a smooth anchor whose other side is a line, locking its direction. */
function handleFollowsLine(contour: Contour, handle: Point): boolean {
  const anchor = contour.cubicHandleAnchor(handle.id);
  if (!anchor?.smooth) return false;

  const points = contour.points;
  const anchorIndex = points.findIndex((point) => point.id === anchor.id);
  const handleIndex = points.findIndex((point) => point.id === handle.id);
  const step = handleIndex - anchorIndex;
  // A closed contour's first and last points are neighbours across the wrap.
  const towardHandle = Math.abs(step) === 1 ? step : -Math.sign(step);
  const opposite = contour.pointAt(anchorIndex - towardHandle);
  return opposite?.isOnCurve ?? false;
}
