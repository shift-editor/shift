import { BaseTool, type ToolName } from "../core";
import type { PenContext, PenCurve, PenEndpoint, PenState } from "./types";
import { PenDownBehaviour, HandleBehavior, EscapeBehavior } from "./behaviors";
import type { CursorType } from "@/types/editor";
import type { Canvas } from "@/lib/editor/rendering/Canvas";
import type { Editor } from "@/lib/editor/Editor";
import { PenTargets } from "./PenTargets";
import { PenOverlay } from "./PenOverlay";
import { Curve, Vec2, type CubicCurve } from "@shift/geo";
import type { ContourId } from "@shift/types";
import {
  computed,
  signal,
  type ComputedSignal,
  type Signal,
  type WritableSignal,
} from "@/lib/signals";
import { PenStroke } from "./PenStroke";

export type { PenState };

export class Pen extends BaseTool<PenState, Pen> {
  readonly id: ToolName = "pen";

  readonly #ctx: WritableSignal<PenContext | null>;
  readonly activeEndpointCell: ComputedSignal<PenEndpoint | null>;
  #penOverlay = new PenOverlay(this);

  readonly behaviors = [new EscapeBehavior(), new PenDownBehaviour(), new HandleBehavior()];

  constructor(editor: Editor) {
    super(editor);
    this.#ctx = signal<PenContext | null>(null, {
      name: "tool.pen.context",
    });
    this.activeEndpointCell = computed(() => {
      const context = this.#ctx.value;
      if (!context?.activeContourId) return null;

      const layer = this.editor
        .glyphForId(context.glyphNode.glyphId)
        ?.layerForSource(context.glyphNode.sourceId);
      const contour = layer?.geometryCell.value.contour(context.activeContourId);
      if (!contour || contour.closed) return null;

      const anchor = contour.lastOnCurvePoint;
      if (!anchor) return null;

      const outgoingHandle = context.outgoingHandle;
      if (outgoingHandle?.pointId === anchor.id) {
        return {
          kind: "smooth",
          pointId: anchor.id,
          position: anchor.position,
          outgoingHandlePosition: outgoingHandle.position,
        };
      }

      const anchorIndex = contour.points.indexOf(anchor);
      const adjacent = contour.points[anchorIndex - 1];
      if (anchor.smooth && adjacent?.isOffCurve) {
        return {
          kind: "smooth",
          pointId: anchor.id,
          position: anchor.position,
          outgoingHandlePosition: Vec2.mirror(adjacent, anchor),
        };
      }

      return { kind: "corner", pointId: anchor.id, position: anchor.position };
    });
  }

  get context(): PenContext | null {
    return this.#ctx.peek();
  }

  get contextCell(): Signal<PenContext | null> {
    return this.#ctx;
  }

  clearContext(): void {
    this.#ctx.set(null);
  }

  setActiveContour(contourId: ContourId): void {
    const context = this.#ctx.peek();
    if (!context) return;

    this.#ctx.set({ ...context, activeContourId: contourId, outgoingHandle: null });
  }

  setActiveEndpoint(endpoint: PenEndpoint): void {
    const context = this.#ctx.peek();
    if (!context?.activeContourId) return;

    const outgoingHandle =
      endpoint.kind === "smooth"
        ? { pointId: endpoint.pointId, position: endpoint.outgoingHandlePosition }
        : null;
    this.#ctx.set({ ...context, outgoingHandle });
  }

  clearActiveContour(): void {
    const context = this.#ctx.peek();
    if (!context) return;

    this.#ctx.set({ ...context, activeContourId: null, outgoingHandle: null });
  }

  resolveCurve(curve: PenCurve): CubicCurve {
    const controlStart =
      curve.start.kind === "corner"
        ? Vec2.lerp(curve.start.position, curve.anchorPosition, 1 / 3)
        : curve.start.outgoingHandlePosition;
    const controlEnd = Vec2.mirror(curve.handlePosition, curve.anchorPosition);

    return Curve.cubic(curve.start.position, controlStart, controlEnd, curve.anchorPosition);
  }

  override getCursor(state: PenState): CursorType {
    if (state.type !== "ready") return { type: "pen" };

    const stroke = PenStroke.active(this);
    if (!stroke) return { type: "pen" };

    const pos = this.editor.input.pointerCell.value;
    if (!pos) return { type: "pen" };

    const nodePoint = this.editor.getPointInNodeSpace(pos.scene, stroke.node.position);
    const targets = PenTargets.forGeometry(stroke.layer.geometry);
    const target = targets.at(nodePoint, this.editor.hitRadius);
    const activeContour = stroke.activeContour;

    switch (target.type) {
      case "terminal": {
        if (activeContour && target.side == "start" && activeContour.points.length > 1) {
          return { type: "pen-end" };
        }

        if (!activeContour) {
          return { type: "pen-end" };
        }
      }
      case "segment": {
        if (!activeContour) return { type: "pen-add" };
      }
    }

    return { type: "pen" };
  }

  protected override isEditing(state: PenState): boolean {
    return state.type === "dragging";
  }

  initialState(): PenState {
    return { type: "idle" };
  }

  override activate(): void {
    this.setState({ type: "ready" });

    const glyphNodes = this.editor.scene.nodesOfKind("glyph");
    if (glyphNodes.length !== 1) return;

    const [node] = glyphNodes;
    if (!node) return;

    this.#ctx.set({
      glyphNode: node,
      activeContourId: null,
      outgoingHandle: null,
    });
  }

  override deactivate(): void {
    this.setState({ type: "idle" });
    this.clearContext();
  }

  override dispose(): void {
    this.activeEndpointCell.dispose();
    super.dispose();
  }

  override drawOverlay(canvas: Canvas): void {
    this.#penOverlay.draw(canvas);
  }
}
