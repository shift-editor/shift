import { BaseCommand, type CommandContext } from "../core/Command";
import type { PointId, ContourId, GlyphSnapshot } from "@shift/types";
import type { ClipboardContent, PasteOptions } from "../../clipboard/types";

/**
 * Removes the specified points from the glyph as part of a cut operation.
 * The clipboard write happens outside this command; CutCommand only handles
 * the destructive removal and undo. Undo restores the full glyph snapshot
 * captured before the cut.
 */
export class CutCommand extends BaseCommand<void> {
  readonly name = "Cut";

  #pointIds: PointId[];
  #beforeSnapshot: GlyphSnapshot | null = null;

  constructor(pointIds: PointId[]) {
    super();
    this.#pointIds = [...pointIds];
  }

  execute(ctx: CommandContext): void {
    this.#beforeSnapshot = ctx.glyph;
    ctx.fontEngine.editing.removePoints(this.#pointIds);
  }

  undo(ctx: CommandContext): void {
    if (this.#beforeSnapshot) {
      ctx.fontEngine.editing.restoreSnapshot(this.#beforeSnapshot);
    }
  }

  redo(ctx: CommandContext): void {
    ctx.fontEngine.editing.removePoints(this.#pointIds);
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
  #beforeSnapshot: GlyphSnapshot | null = null;
  #afterSnapshot: GlyphSnapshot | null = null;
  #createdPointIds: PointId[] = [];
  #createdContourIds: ContourId[] = [];

  constructor(content: ClipboardContent, options: PasteOptions) {
    super();
    this.#content = content;
    this.#options = options;
  }

  execute(ctx: CommandContext): void {
    this.#beforeSnapshot = ctx.glyph;

    const result = ctx.fontEngine.editing.pasteContours(
      this.#content.contours,
      this.#options.offset.x,
      this.#options.offset.y,
    );

    this.#createdPointIds = result.createdPointIds;
    this.#createdContourIds = result.createdContourIds;
    this.#afterSnapshot = ctx.fontEngine.$glyph.value;
  }

  undo(ctx: CommandContext): void {
    if (this.#beforeSnapshot) {
      ctx.fontEngine.editing.restoreSnapshot(this.#beforeSnapshot);
    }
  }

  redo(ctx: CommandContext): void {
    if (this.#afterSnapshot) {
      ctx.fontEngine.editing.restoreSnapshot(this.#afterSnapshot);
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
