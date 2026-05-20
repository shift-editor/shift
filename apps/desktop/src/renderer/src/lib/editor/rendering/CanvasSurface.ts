import type { Rect2D } from "@shift/geo";

/**
 * Immutable snapshot of a canvas element's current layout surface.
 *
 * Surface objects are render inputs. Replacing a surface means the browser
 * backing store or logical layout changed, so renderer effects can depend on
 * these objects directly instead of listening for imperative redraw requests.
 */
export class CanvasSurface {
  readonly canvas: HTMLCanvasElement;
  readonly rect: Rect2D;
  readonly dpr: number;

  protected constructor(canvas: HTMLCanvasElement, rect: Rect2D, dpr: number) {
    this.canvas = canvas;
    this.rect = rect;
    this.dpr = dpr;
  }

  get width(): number {
    return this.rect.width;
  }

  get height(): number {
    return this.rect.height;
  }

  static readRect(canvas: HTMLCanvasElement): Rect2D {
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    };
  }
}

/** Current 2D canvas surface, including a scaled rendering context. */
export class Canvas2DSurface extends CanvasSurface {
  readonly ctx: CanvasRenderingContext2D;

  private constructor(
    canvas: HTMLCanvasElement,
    rect: Rect2D,
    dpr: number,
    ctx: CanvasRenderingContext2D,
  ) {
    super(canvas, rect, dpr);
    this.ctx = ctx;
  }

  static from(canvas: HTMLCanvasElement): Canvas2DSurface {
    const dpr = window.devicePixelRatio;
    const rect = CanvasSurface.readRect(canvas);
    const width = Math.floor(rect.width * dpr);
    const height = Math.floor(rect.height * dpr);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D context");

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return new Canvas2DSurface(canvas, rect, dpr, ctx);
  }
}

/** Current marker/WebGL canvas surface. */
export class MarkerCanvasSurface extends CanvasSurface {
  private constructor(canvas: HTMLCanvasElement, rect: Rect2D, dpr: number) {
    super(canvas, rect, dpr);
  }

  static from(canvas: HTMLCanvasElement): MarkerCanvasSurface {
    return new MarkerCanvasSurface(canvas, CanvasSurface.readRect(canvas), window.devicePixelRatio);
  }
}
