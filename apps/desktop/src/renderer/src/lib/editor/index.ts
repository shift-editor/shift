export { Editor, type ShiftEditor } from "./Editor";
export { ViewportManager, SelectionManager, HoverManager } from "./managers";
export {
  CanvasCoordinator,
  type FontMetrics,
  FrameHandler,
  buildContourPath,
  isContourClockwise,
  SCREEN_HIT_RADIUS,
} from "./rendering";
export type { HandleState, HandleType } from "@/types/graphics";
