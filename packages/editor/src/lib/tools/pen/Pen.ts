import { BaseTool, type ToolName } from "../core";
import type { PenAnchor, PenContext, PenCurve, PenEndpoint, PenState } from "./types";
import {
  PenDownBehaviour,
  HandleBehavior,
  EscapeBehavior,
  CloseBehavior,
  PullHandleBehavior,
} from "./behaviors";
import type { CursorType } from "../../../types/editor";
import type { PositionGuide } from "../../../types/positionEdit";
import type { Canvas } from "../../editor/rendering/Canvas";
import type { Editor } from "../../editor/Editor";
import { PenTargets, type PenTarget } from "./PenTargets";
import { PenOverlay } from "./PenOverlay";
import { Curve, Vec2, type CubicCurve, type Point2D } from "@shift/geo";
import type { ContourId } from "@shift/types";
import {
  computed,
  signal,
  type ComputedSignal,
  type Signal,
  type WritableSignal,
} from "../../signals/index";
import { PenStroke } from "./PenStroke";
import { DirectionSnap, settleSnap } from "../../model/positions/index";
import type { ModifierKeys } from "../core/GestureDetector";

export type { PenState };

export class Pen extends BaseTool<PenState, Pen> {
  readonly id: ToolName = "pen";

  readonly #ctx: WritableSignal<PenContext | null>;
  readonly activeEndpointCell: ComputedSignal<PenEndpoint | null>;
  #penOverlay = new PenOverlay(this);

  readonly behaviors = [
    new EscapeBehavior(),
    new PullHandleBehavior(),
    new PenDownBehaviour(),
    new CloseBehavior(),
    new HandleBehavior(),
  ];

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
          kind: outgoingHandle.smooth ? "smooth" : "cusp",
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
      endpoint.kind === "corner"
        ? null
        : {
            pointId: endpoint.pointId,
            position: endpoint.outgoingHandlePosition,
            smooth: endpoint.kind === "smooth",
          };
    this.#ctx.set({ ...context, outgoingHandle });
  }

  clearActiveContour(): void {
    const context = this.#ctx.peek();
    if (!context) return;

    this.#ctx.set({ ...context, activeContourId: null, outgoingHandle: null });
  }

  /**
   * Resolves where a click at `position` places a new on-curve point.
   *
   * @remarks
   * Shift first quantizes the direction from the active endpoint; metric and on-screen
   * point alignment then snap the result, unless Cmd (Ctrl off macOS) is held.
   *
   * @param position - Pointer position in the stroke's glyph-local units.
   */
  resolveAnchor(
    position: Point2D,
    modifiers: Pick<ModifierKeys, "shiftKey" | "accelKey">,
  ): PenAnchor {
    const endpoint = this.activeEndpointCell.peek();
    const directed = modifiers.shiftKey && endpoint ? this.#directed(endpoint, position) : null;
    let anchor = directed ?? position;
    const guides: PositionGuide[] = [];

    const stroke = PenStroke.active(this);
    const snap =
      stroke && !modifiers.accelKey
        ? this.editor.snapping.forLayer(stroke.layer, stroke.node).snap(anchor)
        : null;
    if (snap) {
      const settled = settleSnap(snap);
      anchor = Vec2.add(anchor, settled.offset);
      guides.push(...settled.guides);
    }

    if (directed && endpoint)
      guides.push({ kind: "direction", from: endpoint.position, to: anchor });
    return { position: anchor, guides };
  }

  /**
   * Where a click on `target` places a new on-curve point.
   *
   * @remarks
   * A hit on-curve point wins outright: the new point lands exactly on it. Empty space
   * resolves through {@link resolveAnchor}.
   */
  anchorFor(
    target: PenTarget & { readonly type: "point" | "empty" },
    position: Point2D,
    modifiers: Pick<ModifierKeys, "shiftKey" | "accelKey">,
  ): PenAnchor {
    if (target.type === "empty") return this.resolveAnchor(position, modifiers);

    const exact = target.position;
    return { position: exact, guides: [{ kind: "alignment", target: exact, point: exact }] };
  }

  #directed(endpoint: PenEndpoint, position: Point2D): Point2D | null {
    const delta = Vec2.sub(position, endpoint.position);
    const snappedDelta = DirectionSnap.everyDegrees(15).apply(delta);
    return snappedDelta ? Vec2.add(endpoint.position, snappedDelta) : null;
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

    const nodePoint = this.editor.toLocal(stroke.node, pos.scene);
    const targets = PenTargets.forGeometry(stroke.layer.geometry);
    const target = targets.at(nodePoint, this.editor.hitRadius);
    const activeEndpoint = stroke.activeEndpoint;

    switch (target.type) {
      case "terminal":
        if (target.pointId === activeEndpoint?.pointId) return { type: "pen" };
        return { type: "pen-end" };
      case "segment":
        if (!activeEndpoint) return { type: "pen-add" };
        return { type: "pen" };
      case "point":
      case "empty":
        return { type: "pen" };
    }
  }

  protected override isEditing(state: PenState): boolean {
    return state.type === "dragging" || state.type === "closing" || state.type === "pulling";
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
