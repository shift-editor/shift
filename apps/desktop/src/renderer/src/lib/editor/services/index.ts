export { SelectionService } from "./SelectionService";
export { HoverService } from "./HoverService";
export { EditService, type EditServiceDeps } from "./EditService";
export { PreviewService, type PreviewServiceDeps } from "./PreviewService";
export { TransformService, type TransformServiceDeps } from "./TransformService";
export { HitTestService, type HitTestServiceDeps, type ContourEndpointHit } from "./HitTestService";
export type {
  HitResult,
  HitTestOptions,
  PointHit,
  SegmentHit,
  ContourEndpointHit as ContourEndpointHitResult, // Full HitResult variant with type discriminator
  BoundingBoxResizeHit,
  BoundingBoxRotateHit,
  CornerHandle,
} from "@/types/hitResult";
export {
  isPointHit,
  isSegmentHit,
  isContourEndpointHit,
  isBoundingBoxResizeHit,
  isBoundingBoxRotateHit,
  isBoundingBoxHit,
} from "@/types/hitResult";
export { CursorService } from "./CursorService";
export { RenderService, type RenderServiceDeps } from "./RenderService";
export { ZoneService, type ZoneServiceDeps } from "./ZoneService";
export { ToolsService, type ToolSwitchHandler, type TemporaryToolOptions } from "./ToolsService";
