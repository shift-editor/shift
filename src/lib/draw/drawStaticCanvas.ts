import AppState from "@/store/store";
import { IRenderer } from "@/types/graphics";

const X_ADVANCE = 600;

const GUIDES = {
  acender: { y: 750 },
  capHeight: { y: 700 },
  xHeight: { y: 500 },
  baseline: { y: 0 },
  descender: { y: -250 },
};

export function drawStaticCanvas(ctx: IRenderer) {
  const { upm, padding, canvasContext } = AppState.getState();
  const { width, height } = canvasContext;

  console.log(padding);
  const transformWithPadding = {
    scale: (width - padding * 2) / upm,
    originX: width - padding,
    originY: height - padding,
  };

  // Clear and set styles
  ctx.clear();

  // Set visible styles
  ctx.strokeStyle = "red";
  ctx.lineWidth = 2;

  // Draw without transform first - should be visible at top-left
  ctx.drawCircle(20, 20, 10);

  ctx.save();

  console.log("Canvas dimensions:", { width, height });

  // Flip Y axis and move origin to bottom-left
  ctx.transform(1, 0, 0, -1, 0, 1000);

  // Draw transformed circle in blue
  ctx.strokeStyle = "blue";
  ctx.drawCircle(100, 100, 50);

  // Draw another circle to verify coordinate system
  ctx.strokeStyle = "green";
  ctx.drawCircle(200, 200, 50);

  ctx.flush();
  ctx.restore();
}
