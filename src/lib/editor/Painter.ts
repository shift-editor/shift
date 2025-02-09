import { IRenderer } from "@/types/graphics";

const X_ADVANCE = 600;

const GUIDES = {
  acender: { y: 750 },
  capHeight: { y: 700 },
  xHeight: { y: 500 },
  baseline: { y: 0 },
  descender: { y: -200 },
};

export class Painter {
  constructor() {}

  public drawStatic(ctx: IRenderer) {
    // metric guides
    ctx.strokeStyle = "rgba(76, 96, 230, 0.75)";

    ctx.beginPath();
    ctx.moveTo(0, GUIDES.descender.y);
    ctx.lineTo(X_ADVANCE, GUIDES.descender.y);
    ctx.lineTo(X_ADVANCE, 200);

    ctx.lineTo(0, 200);
    ctx.lineTo(0, GUIDES.descender.y);

    ctx.moveTo(0, 200);

    ctx.lineTo(0, GUIDES.xHeight.y);
    ctx.lineTo(X_ADVANCE, GUIDES.xHeight.y);
    ctx.lineTo(X_ADVANCE, 200);

    ctx.moveTo(X_ADVANCE, GUIDES.xHeight.y);
    ctx.lineTo(X_ADVANCE, GUIDES.capHeight.y);

    ctx.lineTo(0, GUIDES.capHeight.y);
    ctx.lineTo(0, GUIDES.xHeight.y);

    ctx.moveTo(0, GUIDES.capHeight.y);
    ctx.lineTo(0, GUIDES.acender.y);
    ctx.lineTo(X_ADVANCE, GUIDES.acender.y);
    ctx.lineTo(X_ADVANCE, GUIDES.capHeight.y);

    ctx.stroke();
  }

  public drawInteractive(_: IRenderer): void {}
}
