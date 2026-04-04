import { Vec2 } from "@shift/geo";
import type { AnchorId, Point2D, PointId } from "@shift/types";
import type { ToolContext } from "../../core/Behavior";
import type { EditorAPI } from "../../core/EditorAPI";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectHandlerBehavior, SelectState } from "../types";
import type { SegmentId } from "@/types/indicator";
import { Segments as SegmentOps } from "@/lib/geo/Segments";
import { getPointIdFromHit, isAnchorHit, isSegmentHit } from "@/types/hitResult";
import type { DragSnapSession } from "@/lib/editor/snapping/types";

type TranslatingState = Extract<SelectState, { type: "translating" }>;

export class TranslateBehavior implements SelectHandlerBehavior {
  #snap: DragSnapSession | null = null;

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
    const nextState = this.nextTranslatingState(state, event, ctx.editor);
    ctx.setState(nextState);
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "translating") return false;
    this.finishTranslating(state);
    ctx.setState({ type: "selected" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "translating") return false;
    state.translate.session.cancel();
    ctx.setState({ type: "selected" });
    return true;
  }

  onStateEnter(prev: SelectState, next: SelectState, ctx: ToolContext<SelectState>): void {
    const editor = ctx.editor;
    if (prev.type !== "translating" && next.type === "translating") {
      editor.clearHover();
    }

    if (prev.type === "translating" && next.type !== "translating") {
      this.clearSnap();
      editor.setSnapIndicator(null);
    }
  }

  private nextTranslatingState(
    state: TranslatingState,
    event: ToolEventOf<"drag">,
    editor: EditorAPI,
  ): TranslatingState {
    let newLastPos = event.point;

    if (this.#snap) {
      const result = this.#snap.snap(event.point, { shiftKey: event.shiftKey });
      newLastPos = result.point;
      editor.setSnapIndicator(result.indicator);
    }

    const totalDelta = Vec2.sub(newLastPos, state.translate.startPos);
    state.translate.session.update(totalDelta, newLastPos, {
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey ?? false,
    });

    return {
      type: "translating",
      translate: {
        ...state.translate,
        lastPos: newLastPos,
        totalDelta,
      },
    };
  }

  private finishTranslating(state: TranslatingState): void {
    state.translate.session.commit();
  }

  private tryStartDrag(
    state: SelectState & { type: "ready" | "selected" },
    event: ToolEventOf<"dragStart">,
    editor: EditorAPI,
  ): SelectState | null {
    const hit = editor.getNodeAt(event.coords);
    const pointId = getPointIdFromHit(hit);
    const anchorId = isAnchorHit(hit) ? hit.anchorId : null;

    if (anchorId !== null) {
      const isSelected = state.type === "selected" && editor.isAnchorSelected(anchorId);

      if (!isSelected) {
        const draggedPointIds: PointId[] = [];
        const draggedAnchorIds = [anchorId];
        this.selectAnchor(editor, anchorId, false);
        return this.beginTranslating(editor, event.point, draggedPointIds, draggedAnchorIds);
      }

      const draggedPointIds = editor.getSelectedPoints();
      const draggedAnchorIds = editor.getSelectedAnchors();
      const snapAnchorPointId = draggedPointIds[0] ?? null;
      let anchorPos = event.point;
      if (snapAnchorPointId !== null) {
        anchorPos = this.startSnap(editor, snapAnchorPointId, event.point, draggedPointIds);
      }
      return this.beginTranslating(editor, anchorPos, draggedPointIds, draggedAnchorIds);
    }

    if (pointId !== null) {
      const isSelected = state.type === "selected" && editor.isPointSelected(pointId);

      if (event.altKey) {
        const result = this.startDuplicateDrag(editor, event.point);
        if (result) return result;
      }

      const draggedPointIds = isSelected ? editor.getSelectedPoints() : [pointId];
      const draggedAnchorIds = isSelected ? editor.getSelectedAnchors() : [];
      const anchorPos = this.startSnap(editor, pointId, event.point, draggedPointIds);

      if (!isSelected) {
        this.selectPoint(editor, pointId, false);
      }
      return this.beginTranslating(editor, anchorPos, draggedPointIds, draggedAnchorIds);
    }

    if (isSegmentHit(hit)) {
      console.log("startDrag SEGMENT");
      const pointIds = SegmentOps.getPointIds(hit.segment);
      const isSelected = state.type === "selected" && editor.isSegmentSelected(hit.segmentId);

      if (event.altKey) {
        console.log("startDuplicateDrag SEGMENT");
        const result = this.startDuplicateDrag(editor, event.point);
        if (result) return result;
      }

      const draggedPointIds = isSelected ? editor.getSelectedPoints() : pointIds;
      const draggedAnchorIds = isSelected ? editor.getSelectedAnchors() : [];
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

  private startDuplicateDrag(editor: EditorAPI, startPos: Point2D): SelectState | null {
    const newPointIds = editor.duplicateSelection();
    console.log("startDuplicateDrag NEW POINT IDS", newPointIds);
    const firstPointId = newPointIds[0];
    if (!firstPointId) return null;

    const anchorPos = this.startSnap(editor, firstPointId, startPos, newPointIds);
    editor.clearSelection();
    editor.selectPoints(newPointIds);
    return this.beginTranslating(editor, anchorPos, newPointIds, []);
  }

  private beginTranslating(
    editor: EditorAPI,
    startPointer: Point2D,
    draggedPointIds: PointId[],
    draggedAnchorIds: AnchorId[],
  ): TranslatingState {
    const session = editor.beginTranslateDrag(
      {
        pointIds: draggedPointIds,
        anchorIds: draggedAnchorIds,
      },
      startPointer,
    );

    return {
      type: "translating",
      translate: {
        session,
        startPos: startPointer,
        lastPos: startPointer,
        totalDelta: { x: 0, y: 0 },
      },
    };
  }

  private startSnap(
    editor: EditorAPI,
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

  private selectPoint(editor: EditorAPI, pointId: PointId, additive: boolean): void {
    if (additive) {
      editor.selectPoints([...editor.getSelectedPoints(), pointId]);
      return;
    }

    editor.clearSelection();
    editor.selectPoints([pointId]);
  }

  private selectAnchor(editor: EditorAPI, anchorId: AnchorId, additive: boolean): void {
    if (additive) {
      editor.selectAnchors([...editor.getSelectedAnchors(), anchorId]);
      return;
    }

    editor.clearSelection();
    editor.selectAnchors([anchorId]);
  }

  private selectSegment(editor: EditorAPI, segmentId: SegmentId, additive: boolean): void {
    const segment = editor.getSegmentById(segmentId);
    if (!segment) return;
    const pointIds = SegmentOps.getPointIds(segment);

    if (additive) {
      editor.addSegmentToSelection(segmentId);
      for (const pointId of pointIds) {
        editor.addPointToSelection(pointId);
      }
      return;
    }

    editor.clearSelection();
    editor.selectSegments([segmentId]);
    editor.selectPoints(pointIds);
  }
}
