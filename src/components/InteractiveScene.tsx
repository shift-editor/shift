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
      className={`w-full h-full border border-black cursor-${activeTool} absolute inset-0`}
      style={{
        imageRendering: "pixelated",
      }}
      onMouseDown={() => {
        if (!ctx.current) return;
        const renderer = ctx.current.getContext();
        const scene = AppState.getState().scene;
        const width = scene.width;
        const height = scene.height;
        renderer.drawCircle(width / 2, height / 2, 50);
        renderer.flush();
      }}
    />
  );
};
