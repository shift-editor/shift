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
  // const { dpr, logicalHeight } = AppState.getState().viewportManager;
  const upmMatrix = AppState.getState().viewportManager.upmTransformMatrix();

  ctx.clear();
  ctx.transform(...upmMatrix);

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 1000);
  ctx.lineTo(1000, 1000);
  ctx.lineTo(1000, 0);
  ctx.close();

  ctx.stroke();

  ctx.strokeStyle = "red";
  ctx.drawCircle(0, 0, 5);

  ctx.strokeStyle = "green";
  ctx.drawCircle(500, 500, 5);

  ctx.flush();
  ctx.restore();
}
