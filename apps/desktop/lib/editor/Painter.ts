import { Path2D } from '@/lib/graphics/Path';
import { Line } from '@/lib/math/line';
import { HANDLE_STYLES } from '@/lib/styles/style';
import { IRenderer } from '@/types/graphics';
import { HandleState } from '@/types/handle';

export class Painter {
  public drawGuides(ctx: IRenderer, path: Path2D) {
    ctx.stroke(path);
  }

  public drawFirstHandle(ctx: IRenderer, x: number, y: number, handleState: HandleState) {
    const style = HANDLE_STYLES.first[handleState];

    ctx.setStyle(style);

    if (handleState == 'selected') {
      ctx.fillCircle(x, y, style.size);
    } else {
      ctx.strokeCircle(x, y, style.size);
    }
  }

  public drawLastHandle(
    ctx: IRenderer,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    handleState: HandleState
  ) {
    const style = HANDLE_STYLES.last[handleState];
    ctx.setStyle(style);

    const theta = Math.atan2(y1 - y0, x1 - x0);

    const arrowSize = style.size;
    const arrowAngle = Math.PI / 4;

    const { x, y } = Line.lerp({ x: x0, y: y0 }, { x: x1, y: y1 }, 0.025);
    const distance = Math.hypot(x - x0, y - y0);

    // maintain equal distance between the arrow points
    const lerp = 0.25 / distance;

    for (const p of [0, lerp]) {
      const { x, y } = Line.lerp({ x: x0, y: y0 }, { x: x1, y: y1 }, p);

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(
        x - arrowSize * -Math.cos(theta + arrowAngle),
        y - arrowSize * -Math.sin(theta + arrowAngle)
      );

      ctx.moveTo(x, y);
      ctx.lineTo(
        x - arrowSize * -Math.cos(theta - arrowAngle),
        y - arrowSize * -Math.sin(theta - arrowAngle)
      );
      ctx.stroke();
    }
  }

  public drawCornerHandle(ctx: IRenderer, x: number, y: number, handleState: HandleState): void {
    const style = HANDLE_STYLES.corner[handleState];
    ctx.setStyle(style);

    if (handleState == 'selected') {
      ctx.fillRect(x - style.size / 2, y - style.size / 2, style.size, style.size);
      return;
    }
    ctx.strokeRect(x - style.size / 2, y - style.size / 2, style.size, style.size);
  }

  public drawControlHandle(ctx: IRenderer, x: number, y: number, handleState: HandleState): void {
    const style = HANDLE_STYLES.control[handleState];

    ctx.setStyle(style);
    ctx.strokeCircle(x, y, style.size);
    ctx.fillCircle(x, y, style.size);
  }

  public drawDirectionHandle(
    ctx: IRenderer,
    x: number,
    y: number,
    handleState: HandleState,
    isCounterClockWise?: boolean
  ): void {
    const style = HANDLE_STYLES.direction[handleState];
    ctx.setStyle(style);

    if (handleState == 'selected') {
      ctx.fillCircle(x, y, style.size - 1);
    } else {
      ctx.strokeCircle(x, y, style.size - 1);
    }

    ctx.beginPath();

    const radius = style.size + 6;
    const startAngle = 0;
    const endAngle = Math.PI;

    ctx.arcTo(x, y, radius, startAngle, endAngle, true);
    ctx.stroke();

    // this is a bit janky as we are back in screen space here
    // need to revisit how we achieve keeping the handles the same
    // size no matter the zoom in the painting phase, but whilst keeping
    // everything in UPM always would be ideal
    // const onX = isCounterClockWise ? x + radius : x - radius;
    const onX = isCounterClockWise ? x - radius : x + radius;

    const arrowSize = 8;
    const arrowAngle = Math.PI / 4;

    ctx.beginPath();

    if (isCounterClockWise) {
      ctx.moveTo(onX, y);
      ctx.lineTo(onX - arrowSize * Math.cos(arrowAngle), y - arrowSize * Math.sin(arrowAngle));

      ctx.moveTo(onX, y);
      ctx.lineTo(onX + arrowSize * Math.cos(arrowAngle), y - arrowSize * Math.sin(arrowAngle));
    } else {
      ctx.moveTo(onX, y);
      ctx.lineTo(onX - arrowSize * Math.cos(arrowAngle), y - arrowSize * Math.sin(arrowAngle));

      ctx.moveTo(onX, y);
      ctx.lineTo(onX + arrowSize * Math.cos(arrowAngle), y - arrowSize * Math.sin(arrowAngle));
    }

    ctx.stroke();
  }
}
