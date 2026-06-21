import { Bounds, Vec2, type Point2D } from "@shift/geo";
import type { AnchorId, PointId } from "@shift/types";
import type { GeometryAnchorHit, GeometryPointHit, GeometrySegmentHit } from "@shift/glyph-state";
import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "@/lib/editor/Editor";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { Selectable } from "@/lib/editor/Selection";

import {
  constrainPreparedDrag,
  prepareConstrainedDrag,
  type PreparedConstrainDrag,
} from "@shift/rules";
import type {
  GlyphInstanceGeometry,
  GlyphLayerPositionTarget,
  GlyphLayerPositions,
} from "@/lib/model/Glyph";
import type { GlyphLayerEditDraft } from "@/lib/editor/GlyphLayerEditDraft";

type TranslatingState = Extract<SelectState, { type: "translating" }>;

export class Translate implements SelectBehavior {
  #drag: TranslateDrag | null = null;

  onDragStart(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"dragStart">,
  ): boolean {
    if (state.type !== "idle" && state.type !== "ready") return false;

    const target = TranslateTarget.fromDragStart(ctx.editor, event);
    if (!target) return false;

    target.applySelection(ctx.editor);
    this.#drag = new TranslateDrag(ctx.editor, target, event.coords.glyphLocal);
    ctx.setState(translatingState(this.#drag.startPos));
    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState>, event: ToolEventOf<"drag">): boolean {
    if (state.type !== "translating") return false;
    if (!this.#drag) return false;

    const nextState = this.#nextTranslatingState(state, event);
    ctx.setState(nextState);
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "translating") return false;
    this.#drag?.commit();
    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "translating") return false;
    ctx.setState({ type: "ready" });
    return true;
  }

  onStateEnter(prev: SelectState, next: SelectState, ctx: ToolContext<SelectState>): void {
    const editor = ctx.editor;
    if (prev.type !== "translating" && next.type === "translating") {
      editor.hover.clear();
    }
  }

  #nextTranslatingState(state: TranslatingState, event: ToolEventOf<"drag">): TranslatingState {
    const currentPos = this.#drag!.positionForPointer(event.coords.glyphLocal);
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

class TranslateTarget {
  readonly pointIds: readonly PointId[];
  readonly anchorIds: readonly AnchorId[];
  readonly selection: readonly Selectable[] | null;
  readonly dragAnchor: GlyphLayerPositionTarget | null;

  private constructor(
    pointIds: readonly PointId[],
    anchorIds: readonly AnchorId[],
    selection: readonly Selectable[] | null,
    dragAnchor: GlyphLayerPositionTarget | null,
  ) {
    this.pointIds = [...pointIds];
    this.anchorIds = [...anchorIds];
    this.selection = selection ? [...selection] : null;
    this.dragAnchor = dragAnchor;
  }

  static fromDragStart(editor: Editor, event: ToolEventOf<"dragStart">): TranslateTarget | null {
    const instance = editor.glyphInstance;
    if (!instance?.layer) return null;

    const geometry = instance.geometry;
    const pos = event.coords.glyphLocal;
    const radius = editor.hitRadius;

    const anchorHit = geometry.hitAnchor(pos, radius);
    const pointHit = geometry.hitPoint(pos, radius);
    const segmentHit = geometry.hitSegment(pos, radius);

    return (
      TranslateTarget.fromAnchorHit(editor, anchorHit) ??
      TranslateTarget.fromPointHit(editor, event, pointHit) ??
      TranslateTarget.fromSegmentHit(editor, geometry, event, segmentHit) ??
      TranslateTarget.fromInsideSelectionBounds(editor, pos)
    );
  }

  applySelection(editor: Editor): void {
    if (!this.selection) return;
    editor.selection.select(this.selection);
  }

  static fromAnchorHit(editor: Editor, hit: GeometryAnchorHit | null): TranslateTarget | null {
    if (!hit) return null;

    const selected = editor.selection.isSelected({
      kind: "anchor",
      id: hit.anchorId,
    });

    if (selected) {
      return TranslateTarget.fromSelection(editor, {
        kind: "anchor",
        id: hit.anchorId,
      });
    }

    return new TranslateTarget([], [hit.anchorId], [{ kind: "anchor", id: hit.anchorId }], {
      kind: "anchor",
      id: hit.anchorId,
    });
  }

  static fromPointHit(
    editor: Editor,
    event: ToolEventOf<"dragStart">,
    hit: GeometryPointHit | null,
  ): TranslateTarget | null {
    if (!hit) return null;

    if (event.altKey) {
      return TranslateTarget.fromDuplicatedSelection(editor);
    }

    const selected = editor.selection.isSelected({
      kind: "point",
      id: hit.pointId,
    });

    if (selected) {
      return TranslateTarget.fromSelection(editor, {
        kind: "point",
        id: hit.pointId,
      });
    }

    return new TranslateTarget([hit.pointId], [], [{ kind: "point", id: hit.pointId }], {
      kind: "point",
      id: hit.pointId,
    });
  }

  static fromSegmentHit(
    editor: Editor,
    geometry: GlyphInstanceGeometry,
    event: ToolEventOf<"dragStart">,
    hit: GeometrySegmentHit | null,
  ): TranslateTarget | null {
    if (!hit) return null;

    const segment = geometry.segment(hit.segmentId);
    if (!segment) return null;

    const segmentPointIds = segment.pointIds;
    if (segmentPointIds.length === 0) return null;

    if (event.altKey) {
      return TranslateTarget.fromDuplicatedSelection(editor);
    }

    const selected = editor.selection.isSelected({
      kind: "segment",
      id: hit.segmentId,
    });

    if (selected) {
      return TranslateTarget.fromSelection(editor);
    }

    const pointIds = segmentPointIds.map((id) => ({
      kind: "point" as const,
      id,
    }));
    return new TranslateTarget(
      segmentPointIds,
      [],
      [{ kind: "segment", id: hit.segmentId }, ...pointIds],
      { kind: "point", id: segmentPointIds[0] },
    );
  }

  static fromInsideSelectionBounds(editor: Editor, pos: Point2D): TranslateTarget | null {
    const bounds = editor.selection.bounds;
    if (!bounds) return null;

    const inBounds = Bounds.containsPoint(bounds, pos);
    if (!inBounds) return null;

    return TranslateTarget.fromSelection(editor);
  }

  static fromDuplicatedSelection(editor: Editor): TranslateTarget | null {
    const pointIds = editor.duplicateSelection();
    if (pointIds.length === 0) return null;

    return new TranslateTarget(
      pointIds,
      [],
      pointIds.map((id) => ({ kind: "point" as const, id })),
      { kind: "point", id: pointIds[0] },
    );
  }

  static fromSelection(
    editor: Editor,
    dragAnchor: GlyphLayerPositionTarget | null = null,
  ): TranslateTarget {
    return new TranslateTarget(
      [...editor.selection.pointIds],
      [...editor.selection.anchorIds],
      null,
      dragAnchor,
    );
  }
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
  readonly #target: TranslateTarget;
  readonly #draft: GlyphLayerEditDraft;
  readonly #constraint: ConstrainedTranslate | null;
  readonly #pointerOffset: Point2D;
  readonly startPos: Point2D;

  constructor(editor: Editor, target: TranslateTarget, pointerStart: Point2D) {
    this.#target = target;
    const instance = editor.glyphInstance;

    this.#draft = editor.beginGlyphLayerEditDraft({
      points: target.pointIds,
      anchors: target.anchorIds,
    });

    this.#constraint = instance
      ? ConstrainedTranslate.fromGeometry(instance.geometry, target.pointIds)
      : null;

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
      this.#constraint.positionsFor(this.#draft.basePositions, this.#target, delta),
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
    geometry: GlyphInstanceGeometry,
    pointIds: readonly PointId[],
  ): ConstrainedTranslate | null {
    if (pointIds.length === 0) return null;

    const rules = prepareConstrainedDrag(geometry, new Set(pointIds));
    return new ConstrainedTranslate(rules);
  }

  positionsFor(
    base: GlyphLayerPositions,
    target: TranslateTarget,
    delta: Point2D,
  ): GlyphLayerPositions {
    const updates: GlyphLayerPositions[number][] = [];
    const patch = constrainPreparedDrag(this.#rules, delta, {
      includeMatchedRules: false,
    });

    for (const update of patch.pointUpdates) {
      updates.push({ kind: "point", id: update.id, x: update.x, y: update.y });
    }

    const anchorIds = new Set(target.anchorIds);
    for (const position of base) {
      if (position.kind !== "anchor" || !anchorIds.has(position.id)) continue;
      const next = Vec2.add(position, delta);
      updates.push({ ...position, x: next.x, y: next.y });
    }

    return updates;
  }
}
