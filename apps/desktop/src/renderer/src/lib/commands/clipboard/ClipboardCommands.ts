import { BaseCommand, type CommandContext } from "../core/Command";
import type { PointId, ContourId } from "@shift/types";
import type { ClipboardContent } from "../../clipboard/types";

export class PasteCommand extends BaseCommand<void> {
  readonly name = "Paste";

  #createdPointIds: PointId[] = [];
  #createdContourIds: ContourId[] = [];
  #content: ClipboardContent;
  #offsetX: number;
  #offsetY: number;

  constructor(content: ClipboardContent, offsetX: number = 0, offsetY: number = 0) {
    super();
    this.#content = content;
    this.#offsetX = offsetX;
    this.#offsetY = offsetY;
  }

  execute(ctx: CommandContext): void {
    const contoursJson = JSON.stringify(this.#content.contours);
    const result = ctx.fontEngine.editing.pasteContours(contoursJson, this.#offsetX, this.#offsetY);

    this.#createdPointIds = result.createdPointIds;
    this.#createdContourIds = result.createdContourIds;
  }

  undo(ctx: CommandContext): void {
    for (const contourId of this.#createdContourIds) {
      ctx.fontEngine.editing.removeContour(contourId);
    }
  }

  get createdPointIds(): PointId[] {
    return this.#createdPointIds;
  }

  get createdContourIds(): ContourId[] {
    return this.#createdContourIds;
  }
}
