import "./index.css";
import { useEffect, useRef } from "react";
import {
  SkiaGraphicsContext,
  SkiaRenderer,
} from "./lib/graphics/skia/skiaRenderer";

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

        renderer.drawLine(0, 0, 30, 500);
        renderer.drawRect(90, 90, 400, 400);
        renderer.drawCircle(600, 300, 150);
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
