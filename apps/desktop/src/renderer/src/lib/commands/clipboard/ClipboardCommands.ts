import { BaseCommand, type CommandContext } from "../core/Command";
import type { PointId, ContourId, GlyphState } from "@shift/types";
import { Point } from "@shift/glyph-state";
import type { GlyphSource } from "@/lib/model/Glyph";
import type { ClipboardContent, PasteOptions } from "../../clipboard/types";
import { Vec2 } from "@shift/geo";

/**
 * Removes the specified points from the glyph as part of a cut operation.
 * The clipboard write happens outside this command; CutCommand only handles
 * the destructive removal and undo. Undo restores the full glyph snapshot
 * captured before the cut.
 */
export class CutCommand extends BaseCommand<void> {
  readonly name = "Cut";

  #pointIds: PointId[];
  #beforeState: GlyphState | null = null;

  constructor(pointIds: PointId[]) {
    super();
    this.#pointIds = [...pointIds];
  }

  execute(ctx: CommandContext): void {
    this.#beforeState = ctx.source.state;
    ctx.source.removePoints(this.#pointIds);
  }

  undo(ctx: CommandContext): void {
    if (this.#beforeState) {
      ctx.source.restore(this.#beforeState);
    }
  }

  override redo(ctx: CommandContext): void {
    ctx.source.removePoints(this.#pointIds);
  }
}

/**
 * Pastes clipboard contours into the glyph at the given offset. Tracks
 * created point and contour ids so callers can select the pasted geometry.
 * Uses snapshot-based redo after the first execute to avoid id drift.
 * Access results via {@link createdPointIds} and {@link createdContourIds}.
 */
export class PasteCommand extends BaseCommand<void> {
  readonly name = "Paste";

  #content: ClipboardContent;
  #options: PasteOptions;
  #beforeState: GlyphState | null = null;
  #afterState: GlyphState | null = null;
  #createdPointIds: PointId[] = [];
  #createdContourIds: ContourId[] = [];

  constructor(content: ClipboardContent, options: PasteOptions) {
    super();
    this.#content = content;
    this.#options = options;
  }

  execute(ctx: CommandContext): void {
    this.#beforeState = ctx.source.state;
    const result = pasteContours(ctx.source, this.#content, this.#options);
    this.#createdPointIds = result.createdPointIds;
    this.#createdContourIds = result.createdContourIds;
    this.#afterState = ctx.source.state;
  }

  undo(ctx: CommandContext): void {
    if (this.#beforeState) {
      ctx.source.restore(this.#beforeState);
    }
  }

  override redo(ctx: CommandContext): void {
    if (this.#afterState) {
      ctx.source.restore(this.#afterState);
    } else {
      this.execute(ctx);
    }
  }

  get createdPointIds(): PointId[] {
    return this.#createdPointIds;
  }

  get createdContourIds(): ContourId[] {
    return this.#createdContourIds;
  }
}

function pasteContours(
  source: GlyphSource,
  content: ClipboardContent,
  options: PasteOptions,
): { createdPointIds: PointId[]; createdContourIds: ContourId[] } {
  const createdPointIds: PointId[] = [];
  const createdContourIds: ContourId[] = [];

  for (const contour of content.contours) {
    const contourId = source.addContour();
    createdContourIds.push(contourId);

    for (const point of contour.points) {
      const newPos = Vec2.add(point, options.offset);
      const pointId = source.addPoint(
        contourId,
        Point.create(newPos, point.pointType, point.smooth),
      );
      createdPointIds.push(pointId);
    }

    if (contour.closed) {
      source.closeContour(contourId);
    }
  }

  return { createdPointIds, createdContourIds };
}
