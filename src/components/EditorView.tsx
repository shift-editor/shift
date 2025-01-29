import { Scene } from "../lib/editor/Scene";
import { CanvasKitRenderer } from "../lib/graphics/backends/CanvasKitRenderer";
import AppState from "../store/store";

export interface EditorViewProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  ctx: React.RefObject<CanvasKitRenderer | null>;
  scene: React.RefObject<Scene | null>;
}

export const EditorView = ({ canvasRef, ctx, scene }: EditorViewProps) => {
  const activeTool = AppState((state) => state.activeTool);

  return (
    <div className="w-full h-full overflow-hidden p-8">
      <canvas
        ref={canvasRef}
        className={`w-full h-full border border-black cursor-${activeTool}`}
        style={{
          imageRendering: "pixelated",
        }}
        onMouseDown={(e) => {
          if (scene.current) {
            scene.current.activeTool().onMouseDown(e);
          }
        }}
      />
    </div>
  );
};
