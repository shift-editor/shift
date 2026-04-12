import { Vec2 } from "@shift/geo";
import { Glyphs } from "@shift/font";
import type { AnchorId, GlyphSnapshot, Point2D, PointId } from "@shift/types";
import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "@/lib/editor/Editor";
import type { DragTarget } from "../../core/EditorAPI";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectHandlerBehavior, SelectState } from "../types";
import type { SegmentId } from "@/types/indicator";
import { Segments as SegmentOps } from "@/lib/geo/Segments";
import { getPointIdFromHit, isAnchorHit, isSegmentHit } from "@/types/hitResult";
import type { DragSnapSession } from "@/lib/editor/snapping/types";
import type { GlyphDraft } from "@/types/draft";

import {
  constrainPreparedDrag,
  prepareConstrainDrag,
  type PreparedConstrainDrag,
} from "@shift/rules";
import type { NodePositionUpdateList } from "@/types/positionUpdate";

type TranslatingState = Extract<SelectState, { type: "translating" }>;

export class TranslateBehavior implements SelectHandlerBehavior {
  #snap: DragSnapSession | null = null;
  #draft: GlyphDraft | null = null;
  #target: DragTarget | null = null;
  #rules: PreparedConstrainDrag | null = null;

  onDragStart(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"dragStart">,
  ): boolean {
    if (state.type !== "ready" && state.type !== "selected") return false;

    const nextState = this.tryStartDrag(state, event, ctx.editor);
    if (!nextState) return false;

    ctx.setState(nextState);
    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState>, event: ToolEventOf<"drag">): boolean {
    if (state.type !== "translating") return false;
    if (!this.#draft || !this.#target) return false;

    const nextState = this.nextTranslatingState(state, event, ctx.editor);
    ctx.setState(nextState);
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "translating") return false;
    const label = this.#getDragLabel();
    this.#draft?.finish(label);
    this.#cleanup(ctx.editor);
    ctx.setState({ type: "selected" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "translating") return false;
    this.#draft?.discard();
    this.#cleanup(ctx.editor);
    ctx.setState({ type: "selected" });
    return true;
  }

  onStateEnter(prev: SelectState, next: SelectState, ctx: ToolContext<SelectState>): void {
    const editor = ctx.editor;
    if (prev.type !== "translating" && next.type === "translating") {
      editor.clearHover();
    }

    if (prev.type === "translating" && next.type !== "translating") {
      this.#cleanup(editor);
    }
  }

  #cleanup(editor: Editor): void {
    this.#draft = null;
    this.#target = null;
    this.#rules = null;
    this.clearSnap();
    editor.setSnapIndicator(null);
  }

  #getDragLabel(): string {
    if (!this.#target) return "Move Points";
    if (this.#target.pointIds.length > 0 && this.#target.anchorIds.length > 0) {
      return "Move Selection";
    }
    if (this.#target.anchorIds.length > 0) {
      return "Move Anchors";
    }
    return "Move Points";
  }

  private nextTranslatingState(
    state: TranslatingState,
    event: ToolEventOf<"drag">,
    editor: Editor,
  ): TranslatingState {
    let newLastPos = event.point;

    if (this.#snap) {
      const result = this.#snap.snap(event.point, { shiftKey: event.shiftKey });
      newLastPos = result.point;
      editor.setSnapIndicator(result.indicator);
    }

    const totalDelta = Vec2.sub(newLastPos, state.translate.startPos);
    const updates = buildTranslateUpdates(
      this.#draft!.base,
      this.#target!,
      totalDelta,
      this.#rules,
    );
    this.#draft!.setPositions(updates);

    return {
      type: "translating",
      translate: {
        ...state.translate,
        lastPos: newLastPos,
        totalDelta,
      },
    };
  }

  private tryStartDrag(
    state: SelectState & { type: "ready" | "selected" },
    event: ToolEventOf<"dragStart">,
    editor: Editor,
  ): SelectState | null {
    const hit = editor.getNodeAt(event.coords);
    const pointId = getPointIdFromHit(hit);
    const anchorId = isAnchorHit(hit) ? hit.anchorId : null;

    if (anchorId !== null) {
      const isSelected =
        state.type === "selected" && editor.selection.isSelected({ kind: "anchor", id: anchorId });

      if (!isSelected) {
        const draggedPointIds: PointId[] = [];
        const draggedAnchorIds = [anchorId];
        this.selectAnchor(editor, anchorId, false);
        return this.beginTranslating(editor, event.point, draggedPointIds, draggedAnchorIds);
      }

      const draggedPointIds = [...editor.selection.pointIds];
      const draggedAnchorIds = [...editor.selection.anchorIds];
      const snapAnchorPointId = draggedPointIds[0] ?? null;
      let anchorPos = event.point;
      if (snapAnchorPointId !== null) {
        anchorPos = this.startSnap(editor, snapAnchorPointId, event.point, draggedPointIds);
      }
      return this.beginTranslating(editor, anchorPos, draggedPointIds, draggedAnchorIds);
    }

    if (pointId !== null) {
      const isSelected =
        state.type === "selected" && editor.selection.isSelected({ kind: "point", id: pointId });

      if (event.altKey) {
        const result = this.startDuplicateDrag(editor, event.point);
        if (result) return result;
      }

      const draggedPointIds = isSelected ? [...editor.selection.pointIds] : [pointId];
      const draggedAnchorIds = isSelected ? [...editor.selection.anchorIds] : [];
      const anchorPos = this.startSnap(editor, pointId, event.point, draggedPointIds);

      if (!isSelected) {
        this.selectPoint(editor, pointId, false);
      }
      return this.beginTranslating(editor, anchorPos, draggedPointIds, draggedAnchorIds);
    }

    if (isSegmentHit(hit)) {
      const pointIds = SegmentOps.getPointIds(hit.segment);
      const isSelected =
        state.type === "selected" &&
        editor.selection.isSelected({ kind: "segment", id: hit.segmentId });

      if (event.altKey) {
        const result = this.startDuplicateDrag(editor, event.point);
        if (result) return result;
      }

      const draggedPointIds = isSelected ? [...editor.selection.pointIds] : pointIds;
      const draggedAnchorIds = isSelected ? [...editor.selection.anchorIds] : [];
      const anchorPointId = draggedPointIds[0];
      if (!anchorPointId) return null;

      const anchorPos = this.startSnap(editor, anchorPointId, event.point, draggedPointIds);

      if (!isSelected) {
        this.selectSegment(editor, hit.segmentId, false);
      }
      return this.beginTranslating(editor, anchorPos, draggedPointIds, draggedAnchorIds);
    }

    return null;
  }

  private startDuplicateDrag(editor: Editor, startPos: Point2D): SelectState | null {
    const newPointIds = editor.duplicateSelection();
    const firstPointId = newPointIds[0];
    if (!firstPointId) return null;

    const anchorPos = this.startSnap(editor, firstPointId, startPos, newPointIds);
    editor.selection.select(newPointIds.map((id) => ({ kind: "point", id })));
    return this.beginTranslating(editor, anchorPos, newPointIds, []);
  }

  private beginTranslating(
    editor: Editor,
    startPointer: Point2D,
    draggedPointIds: PointId[],
    draggedAnchorIds: AnchorId[],
  ): TranslatingState {
    this.#draft = editor.createDraft();
    this.#target = {
      pointIds: draggedPointIds,
      anchorIds: draggedAnchorIds,
    };
    this.#rules =
      draggedPointIds.length > 0
        ? prepareConstrainDrag(this.#draft.base, new Set(draggedPointIds))
        : null;

    return {
      type: "translating",
      translate: {
        startPos: startPointer,
        lastPos: startPointer,
        totalDelta: { x: 0, y: 0 },
      },
    };
  }

  private startSnap(
    editor: Editor,
    anchorPointId: PointId,
    dragStart: Point2D,
    excludedPointIds: PointId[],
  ): Point2D {
    this.clearSnap();

    this.#snap = editor.createDragSnapSession({
      anchorPointId,
      dragStart,
      excludedPointIds,
    });

    return this.#snap.getAnchorPosition();
  }

  private clearSnap(): void {
    if (this.#snap) this.#snap.clear();
    this.#snap = null;
  }

  private selectPoint(editor: Editor, pointId: PointId, additive: boolean): void {
    if (additive) {
      editor.selection.add({ kind: "point", id: pointId });
      return;
    }

    editor.selection.select([{ kind: "point", id: pointId }]);
  }

  private selectAnchor(editor: Editor, anchorId: AnchorId, additive: boolean): void {
    if (additive) {
      editor.selection.add({ kind: "anchor", id: anchorId });
      return;
    }

    editor.selection.select([{ kind: "anchor", id: anchorId }]);
  }

  private selectSegment(editor: Editor, segmentId: SegmentId, additive: boolean): void {
    const segment = editor.getSegmentById(segmentId);
    if (!segment) return;
    const pointIds = SegmentOps.getPointIds(segment);

    if (additive) {
      editor.selection.add({ kind: "segment", id: segmentId });
      for (const pointId of pointIds) {
        editor.selection.add({ kind: "point", id: pointId });
      }
      return;
    }

    editor.selection.select([
      { kind: "segment", id: segmentId },
      ...pointIds.map((id) => ({ kind: "point" as const, id })),
    ]);
  }
}

function buildTranslateUpdates(
  base: GlyphSnapshot,
  target: DragTarget,
  delta: Point2D,
  rules: PreparedConstrainDrag | null,
): NodePositionUpdateList {
  const updates: Array<NodePositionUpdateList[number]> = [];

  if (rules) {
    const patch = constrainPreparedDrag(rules, delta, { includeMatchedRules: false });
    for (const u of patch.pointUpdates) {
      updates.push({ node: { kind: "point", id: u.id }, x: u.x, y: u.y });
    }
  } else {
    for (const point of Glyphs.findPoints(base, target.pointIds)) {
      updates.push({
        node: { kind: "point", id: point.id },
        x: point.x + delta.x,
        y: point.y + delta.y,
      });
    }
  }

  for (const anchorId of target.anchorIds) {
    const anchor = base.anchors.find((a) => a.id === anchorId);
    if (!anchor) continue;
    const next = Vec2.add(anchor, delta);
    updates.push({ node: { kind: "anchor", id: anchorId }, x: next.x, y: next.y });
  }

  return updates;
}
