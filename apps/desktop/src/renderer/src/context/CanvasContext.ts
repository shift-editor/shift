import { createContext } from "react";
import type { CanvasRef } from "@/types/graphics";

interface CanvasContextValue {
  markerCanvasRef: CanvasRef;
  overlayCanvasRef: CanvasRef;
  sceneCanvasRef: CanvasRef;
  backgroundCanvasRef: CanvasRef;
}

export const CanvasContext = createContext<CanvasContextValue>({
  markerCanvasRef: { current: null },
  overlayCanvasRef: { current: null },
  sceneCanvasRef: { current: null },
  backgroundCanvasRef: { current: null },
});
