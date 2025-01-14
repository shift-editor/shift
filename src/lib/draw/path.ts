import { HandleType } from "../../types/handle";
import { IRenderer } from "../../types/renderer";
import { Path } from "../core/Path";
import { Handle } from "./Handle";

export const drawPath = (ctx: IRenderer, path: Path) => {
  if (path.points.length == 1) {
    const h = new Handle(path.points[0], HandleType.CORNER);
    h.draw(ctx);
  }
};
