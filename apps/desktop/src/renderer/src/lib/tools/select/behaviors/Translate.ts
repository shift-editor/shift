import { Vec2, type Point2D } from "@shift/geo";

import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "@/lib/editor/Editor";
import type { DragEvent, DragStartEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { Select } from "../Select";
import type { PositionSelection } from "@/types";
import type { GlyphLayerPositionTarget } from "@/lib/model/Glyph";
import { type MoveEdit, PointRuleConstraint, PositionReference } from "@/lib/model/positions";

type TranslatingState = Extract<SelectState, { type: "translating" }>;

export class Translate implements SelectBehavior {
  #drag: TranslateDrag | null = null;

  onDragStart(
    state: SelectState,
    ctx: ToolContext<SelectState, Select>,
    event: DragStartEvent,
  ): boolean {
    if (state.type !== "idle" && state.type !== "ready") return false;

    const drag = this.#fromDragStart(ctx.editor, ctx.tool, event);
    if (!drag) return false;

    this.#drag = drag;
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

  #fromDragStart(editor: Editor, select: Select, event: DragStartEvent): TranslateDrag | null {
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

  #fromPointTarget(editor: Editor, event: DragStartEvent): TranslateDrag | null {
    if (event.target.kind !== "point") return null;
    if (event.altKey) return this.#fromDuplicatedSelection(editor, event.origin.scene);

    const reference = { kind: "point" as const, id: event.target.id };
    if (editor.selection.isSelected(event.target.id)) {
      return this.#fromSelection(editor, event.origin.scene, reference);
    }

    const selection = editor.positionSelection([event.target.id]);
    if (!selection) return null;

    editor.selection.select([event.target.id]);
    return new TranslateDrag(selection, reference, event.origin.scene);
  }

  #fromAnchorTarget(editor: Editor, event: DragStartEvent): TranslateDrag | null {
    if (event.target.kind !== "anchor") return null;

    const reference = { kind: "anchor" as const, id: event.target.id };
    if (editor.selection.isSelected(event.target.id)) {
      return this.#fromSelection(editor, event.origin.scene, reference);
    }

    const selection = editor.positionSelection([event.target.id]);
    if (!selection) return null;

    editor.selection.select([event.target.id]);
    return new TranslateDrag(selection, reference, event.origin.scene);
  }

  #fromSegmentTarget(editor: Editor, event: DragStartEvent): TranslateDrag | null {
    if (event.target.kind !== "segment" || event.target.pointIds.length === 0) return null;
    if (event.altKey) return this.#fromDuplicatedSelection(editor, event.origin.scene);

    if (editor.selection.isSelected(event.target.id)) {
      return this.#fromSelection(editor, event.origin.scene);
    }

    const selection = editor.positionSelection([event.target.id]);
    const referenceId = event.target.pointIds[0];
    if (!selection || !referenceId) return null;

    editor.selection.select([event.target.id, ...event.target.pointIds]);
    return new TranslateDrag(selection, { kind: "point", id: referenceId }, event.origin.scene);
  }

  #fromDuplicatedSelection(editor: Editor, pointerStart: Point2D): TranslateDrag | null {
    const pointIds = editor.duplicateSelection();
    const referenceId = pointIds[0];
    if (!referenceId) return null;

    const selection = editor.positionSelection(pointIds);
    if (!selection) return null;

    editor.selection.select(pointIds);
    return new TranslateDrag(selection, { kind: "point", id: referenceId }, pointerStart);
  }

  #fromSelection(
    editor: Editor,
    pointerStart: Point2D,
    reference: GlyphLayerPositionTarget | null = null,
  ): TranslateDrag | null {
    const selection = editor.positionSelection(editor.selection.ids);
    if (!selection) return null;

    return new TranslateDrag(selection, reference, pointerStart);
  }

  #fromInsideSelectionBounds(
    editor: Editor,
    select: Select,
    event: DragStartEvent,
  ): TranslateDrag | null {
    if (!select.boundingBox.containsTranslationPoint(event.origin)) return null;

    return this.#fromSelection(editor, event.origin.scene);
  }

  #nextTranslatingState(state: TranslatingState, event: DragEvent): TranslatingState {
    const currentPos = this.#drag!.positionForPointer(event.coords.scene);
    const rawDelta = Vec2.sub(currentPos, state.translate.startPos);
    const totalDelta = this.#drag!.preview(rawDelta);

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
  readonly #edit: MoveEdit;
  readonly startPos: Point2D;

  constructor(
    selection: PositionSelection,
    reference: GlyphLayerPositionTarget | null,
    pointerStart: Point2D,
  ) {
    this.#edit = selection.layer.positions.move(selection.targets);

    if (reference) {
      switch (reference.kind) {
        case "point":
          this.#edit.from(PositionReference.point(reference.id));
          break;
        case "anchor":
          this.#edit.from(PositionReference.anchor(reference.id));
          break;
      }
    }

    const pointIds = selection.targets.points ?? [];
    if (pointIds.length > 0) {
      this.#edit.constrainedBy(
        PointRuleConstraint.forSelection(selection.layer.geometry, pointIds),
      );
    }

    this.startPos = pointerStart;
  }

  positionForPointer(pointer: Point2D): Point2D {
    return pointer;
  }

  preview(delta: Point2D): Point2D {
    return this.#edit.preview(delta).delta;
  }

  commit(): void {
    this.#edit.commit();
  }

  discard(): void {
    this.#edit.discard();
  }
}
