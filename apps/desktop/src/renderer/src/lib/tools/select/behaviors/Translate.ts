import { Bounds, Vec2, type Point2D } from "@shift/geo";
import { Point, type Segment } from "@shift/glyph-state";

import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "@/lib/editor/Editor";
import type { GlyphLayerPositionTarget } from "@/lib/model/Glyph";
import type { DragEvent, DragStartEvent, ToolEvent } from "../../core/GestureDetector";
import { DirectionSnap, PositionReference } from "@/lib/model/positions";
import { objectIsKindOf, type ShiftObjectOf } from "@/types";
import type { PositionCondition } from "@/types/positionEdit";
import type { SelectBehavior, SelectState } from "../types";
import type { Select } from "../Select";
import { TranslateInteraction } from "../TranslateInteraction";

type TranslatingState = Extract<SelectState, { type: "translating" }>;

export class Translate implements SelectBehavior {
  #drag: TranslateInteraction | null = null;
  #done: (() => void) | null = null;

  onDragStart(
    state: SelectState,
    ctx: ToolContext<SelectState, Select>,
    event: DragStartEvent,
  ): boolean {
    if (state.type !== "idle" && state.type !== "ready") return false;

    const drag = this.#fromDragStart(ctx.editor, ctx.tool, event);
    if (!drag) return false;

    this.#drag = drag;
    this.#done = ctx.onCancel(() => drag.discard());
    ctx.setState(translatingState(this.#drag.startPos, event.shiftKey));

    if (!event.altKey) this.#configureDirectionSnap(ctx.editor, ctx.tool, drag);

    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState>, event: DragEvent): boolean {
    if (state.type !== "translating") return false;
    if (!this.#drag) return false;

    const nextState = this.#nextTranslatingState(state, event);
    ctx.setState(nextState);
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "translating") return false;

    this.#drag?.commit();
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
    if (event.type !== "drag" || !this.#drag) return;

    const feedback = this.#drag.preview(Vec2.sub(next.translate.lastPos, next.translate.startPos));
    ctx.setState({
      ...next,
      translate: { ...next.translate, totalDelta: feedback.delta, guides: feedback.guides },
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

    for (const segment of segments) {
      const cubic = segment.asCubic();
      if (!cubic) continue;
      if (cubic.controlStart.id === point.id) return PositionReference.point(cubic.start.id);
      if (cubic.controlEnd.id === point.id) return PositionReference.point(cubic.end.id);
    }

    return null;
  }

  #segmentSnapCentre(segments: readonly Segment[]): PositionReference | null {
    const bounds = Bounds.unionAll(segments.map((segment) => segment.bounds));
    if (!bounds) return null;

    return PositionReference.position(Bounds.center(bounds));
  }

  #cleanup(): void {
    this.#drag = null;
    this.#done = null;
  }

  #fromDragStart(
    editor: Editor,
    select: Select,
    event: DragStartEvent,
  ): TranslateInteraction | null {
    switch (event.target.kind) {
      case "point":
        return this.#fromPointTarget(editor, event);
      case "anchor":
        return this.#fromAnchorTarget(editor, event);
      case "segment":
        return this.#fromSegmentTarget(editor, event);
      case "node":
      case "canvas":
        return this.#fromInsideSelectionBounds(editor, select, event);
    }
  }

  #fromPointTarget(editor: Editor, event: DragStartEvent): TranslateInteraction | null {
    if (event.target.kind !== "point") return null;
    if (event.altKey) return this.#fromDuplicatedSelection(editor, event.origin.scene);

    const reference = { kind: "point" as const, id: event.target.id };
    if (editor.selection.isSelected(event.target.id)) {
      return this.#fromSelection(editor, event.origin.scene, reference);
    }

    const selection = editor.positionSelection([event.target.id]);
    if (!selection) return null;

    editor.selection.select([event.target.id]);
    return new TranslateInteraction(selection, reference, event.origin.scene);
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
      },
    };
  }
}

function translatingState(startPos: Point2D, shiftKey: boolean): TranslatingState {
  return {
    type: "translating",
    translate: {
      shiftKey,
      startPos,
      lastPos: startPos,
      totalDelta: { x: 0, y: 0 },
      guides: [],
    },
  };
}
