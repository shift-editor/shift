import AppState from "../store/store";
import { IGraphicContext } from "../types/graphics";

interface InteractiveSceneProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  ctx: React.RefObject<IGraphicContext | null>;
}

export const InteractiveScene = ({ canvasRef, ctx }: InteractiveSceneProps) => {
  const activeTool = AppState((state) => state.activeTool);

  return (
    <canvas
      ref={canvasRef}
      className={`h-full w-full cursor-${activeTool} absolute inset-0`}
      style={{
        imageRendering: "pixelated",
      }}
      onMouseMove={(e) => {
        if (!canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const canvasContext = AppState.getState().canvasContext;
        canvasContext.mouseX = e.clientX - rect.left;
        canvasContext.mouseY = e.clientY - rect.top;
      }}
    />
  );
};
