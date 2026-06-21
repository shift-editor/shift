import type { Command, CommandContext } from "../core/Command";
import type { PointId, ContourId } from "@shift/types";
import { Point } from "@shift/glyph-state";
import type { GlyphLayer } from "@/lib/model/Glyph";
import type { ClipboardContent, PasteOptions } from "../../clipboard/types";
import { Vec2 } from "@shift/geo";

/**
 * Removes the specified points from the glyph as part of a cut operation.
 * The clipboard write happens outside this command; CutCommand only handles
 * the destructive removal.
 */
export class CutCommand implements Command<void> {
  readonly name = "Cut";

  readonly #pointIds: PointId[];

  constructor(pointIds: PointId[]) {
    this.#pointIds = [...pointIds];
  }

  execute(ctx: CommandContext): void {
    ctx.layer.removePoints(this.#pointIds);
  }
}

/**
 * Pastes clipboard contours into the glyph at the given offset. Tracks
 * created point and contour ids so callers can select the pasted geometry.
 * Access results via {@link createdPointIds} and {@link createdContourIds}.
 */
export class PasteCommand implements Command<void> {
  readonly name = "Paste";

  readonly #content: ClipboardContent;
  readonly #options: PasteOptions;
  #createdPointIds: PointId[] = [];
  #createdContourIds: ContourId[] = [];

  constructor(content: ClipboardContent, options: PasteOptions) {
    this.#content = content;
    this.#options = options;
  }

  execute(ctx: CommandContext): void {
    const result = pasteContours(ctx.layer, this.#content, this.#options);
    this.#createdPointIds = result.createdPointIds;
    this.#createdContourIds = result.createdContourIds;
  }

  get createdPointIds(): PointId[] {
    return this.#createdPointIds;
  }

  get createdContourIds(): ContourId[] {
    return this.#createdContourIds;
  }
}

function pasteContours(
  layer: GlyphLayer,
  content: ClipboardContent,
  options: PasteOptions,
): { createdPointIds: PointId[]; createdContourIds: ContourId[] } {
  const createdPointIds: PointId[] = [];
  const createdContourIds: ContourId[] = [];

  for (const contour of content.contours) {
    const contourId = layer.addContour();
    createdContourIds.push(contourId);

    for (const point of contour.points) {
      const newPos = Vec2.add(point, options.offset);
      const pointId = layer.addPoint(
        contourId,
        Point.create(newPos, point.pointType, point.smooth),
      );
      createdPointIds.push(pointId);
    }

    if (contour.closed) {
      layer.closeContour(contourId);
    }
  }

  return { createdPointIds, createdContourIds };
}
