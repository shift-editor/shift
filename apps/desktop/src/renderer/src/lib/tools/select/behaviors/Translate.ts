import { Vec2, type Point2D } from "@shift/geo";
import type { AnchorId, PointId } from "@shift/types";
import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "@/lib/editor/Editor";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import { getPointIdFromHit, isAnchorHit, isSegmentHit, type HitResult } from "@/types/hitResult";

import {
  constrainPreparedDrag,
  prepareConstrainedDrag,
  type PreparedConstrainDrag,
} from "@shift/rules";
import type { GlyphSource, SourcePositions } from "@/lib/model/Glyph";
import type { SourceEditDraft } from "@/lib/editor/SourceEditDraft";

type TranslatingState = Extract<SelectState, { type: "translating" }>;
type TranslateStartState = SelectState & { type: "ready" | "selected" };

export class Translate implements SelectBehavior {
  #drag: TranslateDrag | null = null;

  onDragStart(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"dragStart">,
  ): boolean {
    if (state.type !== "ready" && state.type !== "selected") return false;

    const target = TranslateTarget.fromDragStart(ctx.editor, state, event);
    if (!target) return false;

    target.applySelection(ctx.editor);
    this.#drag = new TranslateDrag(ctx.editor, target);
    ctx.setState(translatingState(event.point));
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
    this.#cleanup();
    ctx.setState({ type: "selected" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "translating") return false;
    this.#drag?.discard();
    this.#cleanup();
    ctx.setState({ type: "selected" });
    return true;
  }

  onStateEnter(prev: SelectState, next: SelectState, ctx: ToolContext<SelectState>): void {
    const editor = ctx.editor;
    if (prev.type !== "translating" && next.type === "translating") {
      editor.clearHover();
    }

    if (prev.type === "translating" && next.type !== "translating") {
      this.#cleanup();
    }
  }

  #cleanup(): void {
    this.#drag?.discard();
    this.#drag = null;
  }

  #nextTranslatingState(state: TranslatingState, event: ToolEventOf<"drag">): TranslatingState {
    const totalDelta = Vec2.sub(event.point, state.translate.startPos);
    this.#drag!.preview(totalDelta);

    return {
      type: "translating",
      translate: {
        ...state.translate,
        lastPos: event.point,
        totalDelta,
      },
    };
  }
}

class TranslateTarget {
  readonly pointIds: readonly PointId[];
  readonly anchorIds: readonly AnchorId[];

  readonly #select: ((editor: Editor) => void) | null;

  private constructor(
    pointIds: readonly PointId[],
    anchorIds: readonly AnchorId[],
    select: ((editor: Editor) => void) | null,
  ) {
    this.pointIds = [...pointIds];
    this.anchorIds = [...anchorIds];
    this.#select = select;
  }

  static fromDragStart(
    editor: Editor,
    state: TranslateStartState,
    event: ToolEventOf<"dragStart">,
  ): TranslateTarget | null {
    const hit = editor.hitTest(event.coords);

    return (
      TranslateTarget.fromAnchorHit(editor, state, hit) ??
      TranslateTarget.fromPointHit(editor, state, event, hit) ??
      TranslateTarget.fromSegmentHit(editor, state, event, hit)
    );
  }

  applySelection(editor: Editor): void {
    if (!this.#select) return;
    this.#select(editor);
  }

  static fromAnchorHit(
    editor: Editor,
    state: TranslateStartState,
    hit: HitResult,
  ): TranslateTarget | null {
    if (!isAnchorHit(hit)) return null;

    const selected =
      state.type === "selected" &&
      editor.selection.isSelected({ kind: "anchor", id: hit.anchorId });

    if (selected) {
      return TranslateTarget.fromSelection(editor);
    }

    return new TranslateTarget([], [hit.anchorId], (editor) => {
      editor.selection.select([{ kind: "anchor", id: hit.anchorId }]);
    });
  }

  static fromPointHit(
    editor: Editor,
    state: TranslateStartState,
    event: ToolEventOf<"dragStart">,
    hit: HitResult,
  ): TranslateTarget | null {
    const pointId = getPointIdFromHit(hit);
    if (pointId === null) return null;

    if (event.altKey) {
      return TranslateTarget.fromDuplicatedSelection(editor);
    }

    const selected =
      state.type === "selected" && editor.selection.isSelected({ kind: "point", id: pointId });

    if (selected) {
      return TranslateTarget.fromSelection(editor);
    }

    return new TranslateTarget([pointId], [], (editor) => {
      editor.selection.select([{ kind: "point", id: pointId }]);
    });
  }

  static fromSegmentHit(
    editor: Editor,
    state: TranslateStartState,
    event: ToolEventOf<"dragStart">,
    hit: HitResult,
  ): TranslateTarget | null {
    if (!isSegmentHit(hit)) return null;

    const segmentPointIds = hit.segment.pointIds;
    if (segmentPointIds.length === 0) return null;

    if (event.altKey) {
      return TranslateTarget.fromDuplicatedSelection(editor);
    }

    const selected =
      state.type === "selected" &&
      editor.selection.isSelected({ kind: "segment", id: hit.segmentId });

    if (selected) {
      return TranslateTarget.fromSelection(editor);
    }

    const pointIds = segmentPointIds.map((id) => ({ kind: "point" as const, id }));
    return new TranslateTarget(segmentPointIds, [], (editor) => {
      editor.selection.select([{ kind: "segment", id: hit.segmentId }, ...pointIds]);
    });
  }

  static fromDuplicatedSelection(editor: Editor): TranslateTarget | null {
    const pointIds = editor.duplicateSelection();
    if (pointIds.length === 0) return null;

    return new TranslateTarget(pointIds, [], (editor) => {
      editor.selection.select(pointIds.map((id) => ({ kind: "point" as const, id })));
    });
  }

  static fromSelection(editor: Editor): TranslateTarget {
    return new TranslateTarget(
      [...editor.selection.pointIds],
      [...editor.selection.anchorIds],
      null,
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
  readonly #draft: SourceEditDraft;
  readonly #constraint: ConstrainedTranslate | null;

  constructor(editor: Editor, target: TranslateTarget) {
    this.#target = target;
    this.#draft = editor.beginSourceEditDraft({
      points: target.pointIds,
      anchors: target.anchorIds,
    });
    this.#constraint = ConstrainedTranslate.fromGlyphSource(
      this.#draft.glyphSource,
      target.pointIds,
    );
  }

  preview(delta: Point2D): void {
    if (!this.#constraint) {
      this.#draft.previewTranslate(delta);
      return;
    }

    this.#draft.previewPositions(
      this.#constraint.positionsFor(this.#draft.basePositions, this.#target, delta),
    );
  }

  commit(): void {
    this.#draft.commit("Move Selection");
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

  static fromGlyphSource(
    glyphSource: GlyphSource,
    pointIds: readonly PointId[],
  ): ConstrainedTranslate | null {
    if (pointIds.length === 0) return null;

    return new ConstrainedTranslate(prepareConstrainedDrag(glyphSource, new Set(pointIds)));
  }

  positionsFor(base: SourcePositions, target: TranslateTarget, delta: Point2D): SourcePositions {
    const updates: SourcePositions[number][] = [];
    const patch = constrainPreparedDrag(this.#rules, delta, { includeMatchedRules: false });

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
