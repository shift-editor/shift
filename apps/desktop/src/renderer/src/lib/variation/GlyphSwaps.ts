import type { Editor } from "@shift/editor";
import { computed, track, type Signal } from "@shift/editor/signals";
import type { NeverUsedSwap } from "@shift/wasm/protocol";
import type {
  SwapId,
  Condition,
  ConditionRange,
  GlyphSwap,
  GlyphId,
  GlyphName,
} from "@shift/types";
import type { SwapRow, SwapsSection } from "@/types/conditions";
import { ConditionChipSpace, withRange, withoutRange } from "./ConditionChipSpace";

/**
 * The glyph being edited's swaps, as the Designspace tab's Swaps
 * section shows and changes them: in the order they are tried, each with its
 * condition's chips, the one the canvas draws here, and those that never draw.
 *
 * @remarks
 * The glyph is the one opened, `dollar`, also while the canvas draws one of
 * its swaps: a swap glyph's own swaps are never applied.
 * Swaps read font axes only. Every rule (which swap draws, which
 * never does, how a chip reads) is the engine's; this lists and names.
 */
export class GlyphSwaps {
  readonly #editor: Editor;
  readonly #chips: ConditionChipSpace;
  readonly #sectionCell: Signal<SwapsSection | null>;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#chips = new ConditionChipSpace(editor, null);
    this.#sectionCell = computed(() => {
      const edited = editor.editedGlyphCell.value;
      if (!edited) return null;

      const { glyphId, drawnGlyphId } = edited;
      const font = editor.font;
      const swaps = font.swapsOf(glyphId);
      const neverUsed = font.neverUsedSwaps(glyphId);
      const inUse = swaps.find((swap) => swap.glyph === drawnGlyphId) ?? null;
      const rows = swaps.map(
        (swap): SwapRow => ({
          id: swap.id,
          glyphId: swap.glyph,
          glyphName: font.glyphName(swap.glyph) ?? swap.glyph,
          chips: this.#chips.chips(swap.condition),
          inUse: swap === inUse,
          neverUsed: this.#neverUsedNote(swap, swaps, neverUsed),
        }),
      );
      return { glyphId, glyphName: font.glyphName(glyphId) ?? glyphId, rows };
    });
  }

  /** The Swaps section; null while no single glyph is edited, empty rows for one with none, which the section says how to start. */
  get sectionCell(): Signal<SwapsSection | null> {
    return this.#sectionCell;
  }

  /** The axes, prefill and reading of the swaps' chips: font axes only. */
  get chips(): ConditionChipSpace {
    return this.#chips;
  }

  /**
   * Adds a swap to the edited glyph, tried after the others: where
   * `range` holds, `glyphId` draws in its place. The swap glyph is
   * loaded first, so the canvas can draw it as soon as it applies.
   *
   * @returns The new swap's id; null with no single glyph edited.
   * @throws {Error} when the engine refuses it.
   */
  async add(glyphId: GlyphId, range: ConditionRange): Promise<SwapId | null> {
    const edited = this.#editor.editedGlyphCell.peek();
    if (!edited) return null;

    await this.#editor.font.loadGlyph(glyphId);
    return this.#editor.font.addGlyphSwap(edited.glyphId, glyphId, { all: [range] });
  }

  /**
   * Creates the glyph `name` for a new swap and adds it where `range`
   * holds, as one step for the user: the glyph is empty until drawn.
   *
   * @returns The new swap's id; null with no single glyph edited.
   */
  async createAndAdd(name: GlyphName, range: ConditionRange): Promise<SwapId | null> {
    if (!this.#editor.editedGlyphCell.peek()) return null;

    const font = this.#editor.font;
    const record = font.createGlyph(name);
    await font.editCoordinator.settled();
    return this.add(record.id, range);
  }

  /**
   * The name a created swap glyph takes: the edited glyph's with
   * `.alt`, `dollar.alt` (or `dollar.alt.1` when taken); null with no single
   * glyph edited.
   */
  newGlyphName(): GlyphName | null {
    const edited = this.#editor.editedGlyphCell.peek();
    const name = edited ? this.#editor.font.glyphName(edited.glyphId) : null;
    if (!name) return null;

    return this.#editor.font.nextAvailableGlyphName(`${name}.alt`);
  }

  /** Replaces the range at `index` of a swap's condition, or adds one when `index` is null. */
  async setRange(swapId: SwapId, index: number | null, range: ConditionRange): Promise<void> {
    const condition = this.#condition(swapId);
    if (!condition) return;

    await this.#setCondition(swapId, withRange(condition, index, range));
  }

  /** Removes the range at `index` of a swap's condition. */
  async removeRange(swapId: SwapId, index: number): Promise<void> {
    const condition = this.#condition(swapId);
    if (!condition) return;

    await this.#setCondition(swapId, withoutRange(condition, index));
  }

  /** Moves a swap to `position` in the order they are tried. */
  async move(swapId: SwapId, position: number): Promise<void> {
    await this.#editor.font.editGlyphSwap(swapId, { kind: "move", move: position });
  }

  /** Removes a swap; its glyph stays in the font. */
  async remove(swapId: SwapId): Promise<void> {
    await this.#editor.font.editGlyphSwap(swapId, { kind: "remove" });
  }

  async #setCondition(swapId: SwapId, condition: Condition): Promise<void> {
    await this.#editor.font.editGlyphSwap(swapId, { kind: "condition", condition });
  }

  #condition(swapId: SwapId): Condition | null {
    const edited = this.#editor.editedGlyphCell.peek();
    if (!edited) return null;

    const swaps = this.#editor.font.swapsOf(edited.glyphId);
    return swaps.find((swap) => swap.id === swapId)?.condition ?? null;
  }

  /** Why `swap` never draws, as its row says it; null when it draws somewhere. */
  #neverUsedNote(
    swap: GlyphSwap,
    swaps: readonly GlyphSwap[],
    neverUsed: readonly NeverUsedSwap[],
  ): string | null {
    track(this.#editor.font.glyphEntriesCell);
    const found = neverUsed.find((entry) => entry.swapId === swap.id);
    if (!found) return null;

    switch (found.reason.kind) {
      case "outsideAxes":
        return "Never used: no location on the axes meets its condition.";
      case "covered": {
        const [first] = found.reason.by;
        const coverer = swaps.find((other) => other.id === first);
        const name = coverer ? this.#editor.font.glyphName(coverer.glyph) : null;
        return `Never used: ${name ?? "a swap"} above always wins first. Drag it below.`;
      }
    }
  }
}
