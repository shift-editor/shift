import "./index.css";
import { useEffect, useRef } from "react";
import {
  SkiaGraphicsContext,
  SkiaRenderer,
} from "./lib/graphics/skia/skiaRenderer";
import chroma from "chroma-js";
import { Handle } from "./lib/graphics/editor/handles/handle";
import { HandleType } from "./lib/graphics/styles/style";
import { Point } from "./lib/geometry/point";

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const drawRect = async (canvas: HTMLCanvasElement) => {
      try {
        const result = await SkiaGraphicsContext.init(canvas);
        if (!result.success) {
          return;
        }
        const renderer = new SkiaRenderer(result.data);

        renderer.drawLine(0, 0, 30, 300, {
          strokeWidth: 2,
          strokeColour: chroma.rgb(76, 96, 230),
        });
        renderer.drawRect(90, 90, 400, 400, {
          strokeWidth: 2,
          strokeColour: chroma.rgb(255, 0, 255),
        });
        renderer.drawCircle(600, 300, 150, {
          strokeWidth: 1,
          strokeColour: chroma.rgb(50, 200, 100),
        });

        const c = new Handle(HandleType.CORNER, Point.create(100, 600));
        c.draw(renderer);

        const ctrl = new Handle(HandleType.CONTROL, Point.create(100, 625));
        ctrl.draw(renderer);
      } catch (error) {
        console.log(error);
      }
    };

    drawRect(canvasRef.current);
  }, []);

  return (
    <main className="w-screen h-screen flex items-center justify-center flex-col p-10">
      <h1>Glyph editor</h1>
      <canvas ref={canvasRef} className="w-full h-full border border-black" />
    </main>
  );
}

export default App;
