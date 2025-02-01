import { InteractiveScene } from "./InteractiveScene";
import { Metrics } from "./Metrics";
import { StaticScene } from "./StaticScene";
import { IGraphicContext } from "../types/graphics";

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
    <div className="relative h-full w-full overflow-hidden">
      <StaticScene canvasRef={staticCanvasRef} ctx={staticContextRef} />
      <InteractiveScene
        canvasRef={interactiveCanvasRef}
        ctx={interactiveContextRef}
      />
      <Metrics />
    </div>
  );
};
