import { Contours } from "@shift/font";
import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { PenState, PenBehavior, ContourContext } from "../types";

export class PenDownBehaviour implements PenBehavior {
  onClick(state: PenState, ctx: ToolContext<PenState>, event: ToolEventOf<"click">): boolean {
    if (state.type !== "ready") return false;

    const editor = ctx.editor;
    const localPoint = event.coords.glyphLocal;
    const activeContour = editor.getActiveContour();
    // clear the selection if we have come from continuing a contour
    editor.clearSelection();

    const hit = editor.getNodeAt(event.coords);
    if (!activeContour && !hit) {
      const contourId = editor.addContour();
      editor.addPointToContour(contourId, localPoint, "onCurve", false);
      ctx.setState({
        type: "ready",
        mousePos: localPoint,
      });
      return true;
    }

    if (activeContour && Contours.canClose(activeContour, localPoint, editor.hitRadius)) {
      editor.closeContour();
      ctx.setState({
        type: "ready",
        mousePos: localPoint,
      });

      return true;
    }

    if (hit) {
      switch (hit.type) {
        case "contourEndpoint": {
          editor.continueContour(hit.contourId, hit.position === "start", hit.pointId);
          ctx.setState({
            type: "ready",
            mousePos: localPoint,
          });
          return true;
        }

        case "segment": {
          editor.splitSegment(hit.segment, hit.t);
          ctx.setState({
            type: "ready",
            mousePos: localPoint,
          });
          return true;
        }
      }
    }

    if (!activeContour) return false;
    editor.addPointToContour(activeContour.id, localPoint, "onCurve", false);

    return true;
  }

  onDragStart(
    _state: PenState,
    ctx: ToolContext<PenState>,
    event: ToolEventOf<"dragStart">,
  ): boolean {
    const editor = ctx.editor;

    const hit = editor.getNodeAt(event.coords);
    if (hit && (hit.type === "segment" || hit.type === "middlePoint")) {
      return false;
    }

    const activeContour = editor.getActiveContour();
    if (!activeContour) return false;

    // drag when over corner point
    // when placing a new point
    // when continuing a contour
    // drag when line segment
    // upgrades to a bezier
    const id = editor.addPointToContour(
      activeContour.id,
      event.coords.glyphLocal,
      "offCurve",
      false,
    );

    ctx.setState({
      type: "anchored",
      anchor: {
        position: event.coords.glyphLocal,
        pointId: id,
        context: {} as ContourContext,
      },
    });
    // // add point, that will turn into an bezier
    // const context = this.buildContourContext(editor);
    // const pointId = placePenPoint(editor, localPoint);
    // ctx.setState({
    //   type: "anchored",
    //   anchor: {
    //     position: localPoint,
    //     pointId,
    //     context,
    //   },
    // });
    return true;
  }

  // private handlePlace(
  //   state: PenState,
  //   ctx: ToolContext<PenState>,
  //   event: ToolEventOf<"click" | "dragStart">,
  // ): boolean {
  //   if (!hasActiveDrawingContour) {
  //     const hit = editor.getNodeAt(event.coords);
  //
  //     if (isContourEndpointHit(hit) && !hit.contour.closed) {
  //       continuePenContour(editor, hit.contourId, hit.position === "start", hit.pointId);
  //       ctx.setState({
  //         type: "ready",
  //         mousePos: localPoint,
  //       });
  //       return true;
  //     }
  //
  //     if (isMiddlePointHit(hit)) {
  //       editor.setActiveContour(hit.contourId);
  //       ctx.setState({
  //         type: "ready",
  //         mousePos: localPoint,
  //       });
  //       return true;
  //     }
  //
  //     if (isSegmentHit(hit)) {
  //       splitPenSegment(editor, hit.segment, hit.t);
  //       ctx.setState({
  //         type: "ready",
  //         mousePos: localPoint,
  //       });
  //       return true;
  //     }
  //   }
  //
  //   try {
  //     placePenPoint(editor, localPoint);
  //     commitPenGesture(editor, "Add Point");
  //   } catch (error) {
  //     cancelPenGesture(editor);
  //     throw error;
  //   }
  //   ctx.setState({
  //     type: "ready",
  //     mousePos: localPoint,
  //   });
  //   return true;
  // }
  //
  // private buildContourContext(editor: EditorAPI): ContourContext {
  //   const contour = editor.getActiveContour();
  //   if (!contour || Contours.isEmpty(contour)) {
  //     return {
  //       previousPointType: "none",
  //       previousOnCurvePosition: null,
  //       isFirstPoint: true,
  //     };
  //   }
  //
  //   const lastPoint = Contours.lastPoint(contour);
  //   if (!lastPoint) {
  //     return {
  //       previousPointType: "none",
  //       previousOnCurvePosition: null,
  //       isFirstPoint: true,
  //     };
  //   }
  //
  //   const lastOnCurve = Contours.lastOnCurvePoint(contour);
  //
  //   return {
  //     previousPointType: lastPoint.pointType,
  //     previousOnCurvePosition: lastOnCurve,
  //     isFirstPoint: false,
  //   };
  // }
}
