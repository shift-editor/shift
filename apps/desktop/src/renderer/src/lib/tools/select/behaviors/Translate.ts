import { Rect, Vec2, type Point2D } from "@shift/geo";
import type { AnchorId, PointId } from "@shift/types";
import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "@/lib/editor/Editor";
import type { DragEvent, DragStartEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { GlyphAnchorTarget, GlyphPointTarget, GlyphSegmentTarget } from "@/types/target";
import type { ShiftId } from "@/types";
import { selectedGeometryEdit } from "./selectedGeometryEdit";

import {
  constrainPreparedDrag,
  prepareConstrainedDrag,
  type ConstrainDragGlyph,
  type PreparedConstrainDrag,
} from "@shift/rules";
import type { GlyphLayer, GlyphLayerPositionTarget, GlyphLayerPositions } from "@/lib/model/Glyph";
import { GlyphLayerEditDraft } from "@/lib/editor/GlyphLayerEditDraft";

type TranslatingState = Extract<SelectState, { type: "translating" }>;

export class Translate implements SelectBehavior {
  #drag: TranslateDrag | null = null;

  onDragStart(state: SelectState, ctx: ToolContext<SelectState>, event: DragStartEvent): boolean {
    if (state.type !== "idle" && state.type !== "ready") return false;

    const operation = TranslateOperation.fromDragStart(ctx.editor, event);
    if (!operation) return false;

    operation.applySelection(ctx.editor);
    this.#drag = new TranslateDrag(operation, event.coords.scene);
    ctx.setState(translatingState(this.#drag.startPos));
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
    this.#drag = null;
    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "translating") return false;
    this.#drag?.discard();
    this.#drag = null;
    ctx.setState({ type: "ready" });
    return true;
  }

  onStateEnter(prev: SelectState, next: SelectState, ctx: ToolContext<SelectState>): void {
    const editor = ctx.editor;
    if (prev.type !== "translating" && next.type === "translating") {
      editor.hover.clear();
    }
  }

  #nextTranslatingState(state: TranslatingState, event: DragEvent): TranslatingState {
    const currentPos = this.#drag!.positionForPointer(event.coords.scene);
    const totalDelta = Vec2.sub(currentPos, state.translate.startPos);
    this.#drag!.preview(totalDelta);

    return {
      type: "translating",
      translate: {
        ...state.translate,
        lastPos: currentPos,
        totalDelta,
      },
    };
  }
}

/**
 * A resolved glyph-layer move: the subject point/anchor ids together with the
 * single authored layer that owns all of them.
 *
 * Construction is where edit scoping happens. Builders resolve identity-only
 * hit and selection ids through font ownership queries and refuse to produce
 * an operation when the ids span layers, are absent from current layer state,
 * or the resolved layer is not the one displayed at the current design location. Node
 * translation is a separate future operation kind; node targets never
 * produce one of these.
 */
class TranslateOperation {
  readonly layer: GlyphLayer;
  readonly pointIds: readonly PointId[];
  readonly anchorIds: readonly AnchorId[];
  readonly selection: readonly ShiftId[] | null;
  readonly dragAnchor: GlyphLayerPositionTarget | null;

  private constructor(
    layer: GlyphLayer,
    pointIds: readonly PointId[],
    anchorIds: readonly AnchorId[],
    selection: readonly ShiftId[] | null,
    dragAnchor: GlyphLayerPositionTarget | null,
  ) {
    this.layer = layer;
    this.pointIds = [...pointIds];
    this.anchorIds = [...anchorIds];
    this.selection = selection ? [...selection] : null;
    this.dragAnchor = dragAnchor;
  }

  static fromDragStart(editor: Editor, event: DragStartEvent): TranslateOperation | null {
    const target = event.target;

    switch (target.kind) {
      case "point":
        return TranslateOperation.fromPointTarget(editor, event, target);
      case "anchor":
        return TranslateOperation.fromAnchorTarget(editor, target);
      case "segment":
        return TranslateOperation.fromSegmentTarget(editor, event, target);
      case "node":
      case "canvas":
        return TranslateOperation.fromInsideSelectionBounds(editor, event);
    }
  }

  applySelection(editor: Editor): void {
    if (!this.selection) return;
    editor.selection.select(this.selection);
  }

  static fromPointTarget(
    editor: Editor,
    event: DragStartEvent,
    target: GlyphPointTarget,
  ): TranslateOperation | null {
    if (event.altKey) {
      return TranslateOperation.fromDuplicatedSelection(editor);
    }

    const selected = editor.selection.isSelected(target.id);

    if (selected) {
      return TranslateOperation.fromSelection(editor, {
        kind: "point",
        id: target.id,
      });
    }

    return TranslateOperation.#resolve(editor, [target.id], [], [target.id], {
      kind: "point",
      id: target.id,
    });
  }

  static fromAnchorTarget(editor: Editor, target: GlyphAnchorTarget): TranslateOperation | null {
    const selected = editor.selection.isSelected(target.id);

    if (selected) {
      return TranslateOperation.fromSelection(editor, {
        kind: "anchor",
        id: target.id,
      });
    }

    return TranslateOperation.#resolve(editor, [], [target.id], [target.id], {
      kind: "anchor",
      id: target.id,
    });
  }

  static fromSegmentTarget(
    editor: Editor,
    event: DragStartEvent,
    target: GlyphSegmentTarget,
  ): TranslateOperation | null {
    const segmentPointIds = target.pointIds;
    if (segmentPointIds.length === 0) return null;

    if (event.altKey) {
      return TranslateOperation.fromDuplicatedSelection(editor);
    }

    const selected = editor.selection.isSelected(target.id);

    if (selected) {
      return TranslateOperation.fromSelection(editor);
    }

    return TranslateOperation.#resolve(
      editor,
      segmentPointIds,
      [],
      [target.id, ...segmentPointIds],
      { kind: "point", id: segmentPointIds[0]! },
    );
  }

  static fromDuplicatedSelection(editor: Editor): TranslateOperation | null {
    const pointIds = editor.duplicateSelection();
    if (pointIds.length === 0) return null;

    return TranslateOperation.#resolve(editor, pointIds, [], pointIds, {
      kind: "point",
      id: pointIds[0]!,
    });
  }

  static fromSelection(
    editor: Editor,
    dragAnchor: GlyphLayerPositionTarget | null = null,
  ): TranslateOperation | null {
    const edit = selectedGeometryEdit(editor);
    if (!edit || !isDisplayedLayer(editor, edit.layer)) return null;

    return new TranslateOperation(edit.layer, edit.pointIds, edit.anchorIds, null, dragAnchor);
  }

  static fromInsideSelectionBounds(
    editor: Editor,
    event: DragStartEvent,
  ): TranslateOperation | null {
    const bounds = editor.selectionBounds();
    if (!bounds) return null;

    if (!Rect.containsPoint(bounds, event.origin.scene)) return null;

    return TranslateOperation.fromSelection(editor);
  }

  static #resolve(
    editor: Editor,
    pointIds: readonly PointId[],
    anchorIds: readonly AnchorId[],
    selection: readonly ShiftId[],
    dragAnchor: GlyphLayerPositionTarget | null,
  ): TranslateOperation | null {
    const layer = editor.font.layerForGeometry({ points: pointIds, anchors: anchorIds });
    if (!layer || !isDisplayedLayer(editor, layer)) return null;

    return new TranslateOperation(layer, pointIds, anchorIds, selection, dragAnchor);
  }
}

/**
 * Interpolated views hit-test against geometry whose ids come from an
 * authored layer's structure, so ownership alone would let a drag silently
 * edit that layer while the user looks at an interpolation. A move may only
 * start when the resolved layer is authored at the active source.
 */
function isDisplayedLayer(editor: Editor, layer: GlyphLayer): boolean {
  const sourceId = editor.activeSourceId;
  return sourceId !== null && layer.sourceId === sourceId;
}

function translatingState(startPos: Point2D): TranslatingState {
  return {
    type: "translating",
    translate: {
      startPos,
      lastPos: startPos,
      totalDelta: { x: 0, y: 0 },
    },
  };
}

class TranslateDrag {
  readonly #operation: TranslateOperation;
  readonly #draft: GlyphLayerEditDraft;
  readonly #constraint: ConstrainedTranslate | null;
  readonly #pointerOffset: Point2D;
  readonly startPos: Point2D;

  constructor(operation: TranslateOperation, pointerStart: Point2D) {
    this.#operation = operation;

    this.#draft = new GlyphLayerEditDraft(operation.layer, {
      points: operation.pointIds,
      anchors: operation.anchorIds,
    });

    this.#constraint = ConstrainedTranslate.fromGeometry(
      operation.layer.geometry,
      operation.pointIds,
    );

    this.startPos = pointerStart;
    this.#pointerOffset = Vec2.sub(pointerStart, this.startPos);
  }

  positionForPointer(pointer: Point2D): Point2D {
    return Vec2.sub(pointer, this.#pointerOffset);
  }

  preview(delta: Point2D): void {
    if (!this.#constraint) {
      this.#draft.previewTranslate(delta);
      return;
    }

    this.#draft.previewPositionPatch(
      this.#constraint.positionsFor(this.#draft.basePositions, this.#operation.anchorIds, delta),
    );
  }

  commit(): void {
    this.#draft.commit();
  }

  discard(): void {
    this.#draft.discard();
  }
}

class ConstrainedTranslate {
  readonly #rules: PreparedConstrainDrag;

  private constructor(rules: PreparedConstrainDrag) {
    this.#rules = rules;
  }

  static fromGeometry(
    geometry: ConstrainDragGlyph,
    pointIds: readonly PointId[],
  ): ConstrainedTranslate | null {
    if (pointIds.length === 0) return null;

    const rules = prepareConstrainedDrag(geometry, new Set(pointIds));
    return new ConstrainedTranslate(rules);
  }

  positionsFor(
    base: GlyphLayerPositions,
    anchorIds: readonly AnchorId[],
    delta: Point2D,
  ): GlyphLayerPositions {
    const updates: GlyphLayerPositions[number][] = [];
    const patch = constrainPreparedDrag(this.#rules, delta, {
      includeMatchedRules: false,
    });

    for (const update of patch.pointUpdates) {
      updates.push({ kind: "point", id: update.id, x: update.x, y: update.y });
    }

    const anchors = new Set(anchorIds);
    for (const position of base) {
      if (position.kind !== "anchor" || !anchors.has(position.id)) continue;
      const next = Vec2.add(position, delta);
      updates.push({ ...position, x: next.x, y: next.y });
    }

    return updates;
  }
}
