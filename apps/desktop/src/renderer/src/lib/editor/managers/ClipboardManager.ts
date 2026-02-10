import type { Glyph, PointId } from "@shift/types";
import type { Signal } from "@/lib/reactive/signal";
import type { SegmentId } from "@/types/indicator";
import type { CommandHistory } from "@/lib/commands";
import { ClipboardService } from "@/lib/clipboard";
import { CutCommand, PasteCommand } from "@/lib/commands";

/**
 * Dependency interface for {@link ClipboardManager}.
 *
 * Provides access to the current glyph, selection state, command history,
 * and selection mutation callbacks needed for copy/cut/paste orchestration.
 */
export interface Clipboard {
  readonly glyph: Signal<Glyph | null>;
  getSelectedPoints(): PointId[];
  getSelectedSegments(): SegmentId[];
  readonly commands: CommandHistory;
  selectPoints(ids: readonly PointId[]): void;
  clearSelection(): void;
}

/**
 * Owns the clipboard service and orchestrates copy, cut, and paste operations.
 *
 * Encapsulates {@link ClipboardService}, {@link ContentResolver}, and the
 * command-history interactions needed for undoable cut/paste. The manager
 * reads glyph and selection state through the {@link Clipboard} dependency
 * interface so it stays decoupled from the concrete Editor class.
 */
export class ClipboardManager {
  readonly #deps: Clipboard;
  readonly #service: ClipboardService;

  constructor(deps: Clipboard) {
    this.#deps = deps;
    this.#service = new ClipboardService({
      getGlyph: () => deps.glyph.peek(),
      getSelectedPointIds: () => deps.getSelectedPoints(),
      getSelectedSegmentIds: () => deps.getSelectedSegments(),
    });
  }

  /** Copies the current selection to the system clipboard. Returns false if nothing was copied. */
  async copy(): Promise<boolean> {
    const content = this.#service.resolveSelection();
    if (!content || content.contours.length === 0) return false;

    const glyph = this.#deps.glyph.peek();
    return this.#service.write(content, glyph?.name);
  }

  /** Copies the selection to the clipboard, then removes the selected points via an undoable command. */
  async cut(): Promise<boolean> {
    const content = this.#service.resolveSelection();
    if (!content || content.contours.length === 0) return false;

    const glyph = this.#deps.glyph.peek();
    const written = await this.#service.write(content, glyph?.name);
    if (!written) return false;

    const pointIds = this.#deps.getSelectedPoints();
    const cmd = new CutCommand(pointIds);
    this.#deps.commands.execute(cmd);

    this.#deps.clearSelection();
    return true;
  }

  /** Reads contour data from the clipboard and pastes it into the glyph with an incremental offset. */
  async paste(): Promise<void> {
    const state = await this.#service.read();
    if (!state.content || state.content.contours.length === 0) return;

    const offset = this.#service.getNextPasteOffset();
    const cmd = new PasteCommand(state.content, { offset });
    this.#deps.commands.execute(cmd);

    if (cmd.createdPointIds.length > 0) {
      this.#deps.selectPoints(cmd.createdPointIds);
    }
  }
}
