/**
 * Derived from napi-rs generated FontEngine class — zero maintenance.
 * When you add a #[napi] method in Rust and rebuild, it appears here automatically.
 */
import type {
  FontEngine,
  JsGlyphRef,
  JsNodeRef,
  JsNodePositionUpdate,
  JsPointMove,
  JsAffineTransform,
} from "shift-node";
import type { RenderContourSnapshot } from "@shift/types";

export type FontEngineAPI = Omit<FontEngine, "constructor">;

export type GlyphRef = JsGlyphRef;
export type NodeRef = JsNodeRef;
export type NodePositionUpdate = JsNodePositionUpdate;
export type PointMove = JsPointMove;
export type AffineTransformPayload = JsAffineTransform;

export interface CompositeComponentPayload {
  componentGlyphName: string;
  sourceUnicodes: number[];
  contours: RenderContourSnapshot[];
}

export interface CompositeComponentsPayload {
  glyphName: string;
  components: CompositeComponentPayload[];
}

declare global {
  interface Window {
    shiftFont?: FontEngineAPI;
  }
}
