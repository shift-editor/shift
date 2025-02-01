import { IGraphicContext } from "../types/graphics";

interface StaticSceneProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  ctx: React.RefObject<IGraphicContext | null>;
}

export const StaticScene = ({ canvasRef, ctx }: StaticSceneProps) => {
  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full absolute inset-0"
      style={{ imageRendering: "pixelated" }}
    />
  );
};
