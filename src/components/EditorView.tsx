import { IGraphicContext } from "../types/graphics";
import { InteractiveScene } from "./InteractiveScene";
import { StaticScene } from "./StaticScene";

export interface EditorViewProps {
  interactiveCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  staticCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  interactiveContextRef: React.RefObject<IGraphicContext | null>;
  staticContextRef: React.RefObject<IGraphicContext | null>;
}

export const EditorView = ({
  interactiveCanvasRef,
  staticCanvasRef,
  interactiveContextRef,
  staticContextRef,
}: EditorViewProps) => {
  return (
    <div className="w-full h-full overflow-hidden relative">
      <StaticScene canvasRef={staticCanvasRef} ctx={staticContextRef} />
      <InteractiveScene
        canvasRef={interactiveCanvasRef}
        ctx={interactiveContextRef}
      />
    </div>
  );
};
