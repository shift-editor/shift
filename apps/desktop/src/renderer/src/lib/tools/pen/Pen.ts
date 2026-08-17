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
import { signal, type Signal, type WritableSignal } from "@/lib/signals";
import { PenStroke } from "./PenStroke";

export type { PenState };

export class Pen extends BaseTool<PenState, Pen> {
  readonly id: ToolName = "pen";

  readonly #ctx: WritableSignal<PenContext | null>;
  #penOverlay = new PenOverlay(this);

  readonly behaviors = [new EscapeBehavior(), new PenDownBehaviour(), new HandleBehavior()];

  constructor(editor: Editor) {
    super(editor);
    this.#ctx = signal<PenContext | null>(null, {
      name: "tool.pen.context",
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

  setActiveContour(contourId: ContourId, endpoint: PenEndpoint): void {
    const context = this.#ctx.peek();
    if (!context) return;

    this.#ctx.set({ ...context, activeContourId: contourId, activeEndpoint: endpoint });
  }

  setActiveEndpoint(endpoint: PenEndpoint): void {
    const context = this.#ctx.peek();
    if (!context?.activeContourId) return;

    this.#ctx.set({ ...context, activeEndpoint: endpoint });
  }

  clearActiveContour(): void {
    const context = this.#ctx.peek();
    if (!context) return;

    this.#ctx.set({ ...context, activeContourId: null, activeEndpoint: null });
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
      activeEndpoint: null,
    });
  }

  override deactivate(): void {
    this.setState({ type: "idle" });
    this.clearContext();
  }

  override drawOverlay(canvas: Canvas): void {
    this.#penOverlay.draw(canvas);
  }
}
