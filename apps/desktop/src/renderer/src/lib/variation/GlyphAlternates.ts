import type { Editor } from "@shift/editor";
import { computed, track, type Signal } from "@shift/editor/signals";
import type { NeverUsedAlternate } from "@shift/wasm/protocol";
import type {
  AlternateId,
  Condition,
  ConditionRange,
  GlyphAlternate,
  GlyphId,
  GlyphName,
} from "@shift/types";
import type { AlternateRow, AlternatesSection } from "@/types/conditions";
import { ConditionChipSpace, withRange, withoutRange } from "./ConditionChipSpace";

/**
 * The glyph being edited's alternates, as the Designspace tab's Alternates
 * section shows and changes them: in the order they are tried, each with its
 * condition's chips, the one the canvas draws here, and those that never draw.
 *
 * @remarks
 * The glyph is the one opened, `dollar`, also while the canvas draws one of
 * its alternates: an alternate glyph's own alternates are never applied.
 * Alternates read font axes only. Every rule (which alternate draws, which
 * never does, how a chip reads) is the engine's; this lists and names.
 */
export class GlyphAlternates {
  readonly #editor: Editor;
  readonly #chips: ConditionChipSpace;
  readonly #sectionCell: Signal<AlternatesSection | null>;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#chips = new ConditionChipSpace(editor, null);
    this.#sectionCell = computed(() => {
      const edited = editor.editedGlyphCell.value;
      if (!edited) return null;

      const { glyphId, drawnGlyphId } = edited;
      const font = editor.font;
      const alternates = font.alternatesOf(glyphId);
      const neverUsed = font.neverUsedAlternates(glyphId);
      const inUse = alternates.find((alternate) => alternate.glyph === drawnGlyphId) ?? null;
      const rows = alternates.map(
        (alternate): AlternateRow => ({
          id: alternate.id,
          glyphId: alternate.glyph,
          glyphName: font.glyphName(alternate.glyph) ?? alternate.glyph,
          chips: this.#chips.chips(alternate.condition),
          inUse: alternate === inUse,
          neverUsed: this.#neverUsedNote(alternate, alternates, neverUsed),
        }),
      );
      return { glyphId, glyphName: font.glyphName(glyphId) ?? glyphId, rows };
    });
  }

  /** The Alternates section; null while no single glyph is edited, empty rows for one with none ("None"). */
  get sectionCell(): Signal<AlternatesSection | null> {
    return this.#sectionCell;
  }

  /** The axes, prefill and reading of the alternates' chips: font axes only. */
  get chips(): ConditionChipSpace {
    return this.#chips;
  }

  /**
   * Adds an alternate to the edited glyph, tried after the others: where
   * `range` holds, `glyphId` draws in its place. The alternate glyph is
   * loaded first, so the canvas can draw it as soon as it applies.
   *
   * @returns The new alternate's id; null with no single glyph edited.
   * @throws {Error} when the engine refuses it.
   */
  async add(glyphId: GlyphId, range: ConditionRange): Promise<AlternateId | null> {
    const edited = this.#editor.editedGlyphCell.peek();
    if (!edited) return null;

    await this.#editor.font.loadGlyph(glyphId);
    return this.#editor.font.addGlyphAlternate(edited.glyphId, glyphId, { all: [range] });
  }

  /**
   * Creates the glyph `name` for a new alternate and adds it where `range`
   * holds, as one step for the user: the glyph is empty until drawn.
   *
   * @returns The new alternate's id; null with no single glyph edited.
   */
  async createAndAdd(name: GlyphName, range: ConditionRange): Promise<AlternateId | null> {
    if (!this.#editor.editedGlyphCell.peek()) return null;

    const font = this.#editor.font;
    const record = font.createGlyph(name);
    await font.editCoordinator.settled();
    return this.add(record.id, range);
  }

  /**
   * The name a created alternate glyph takes: the edited glyph's with
   * `.alt`, `dollar.alt` (or `dollar.alt.1` when taken); null with no single
   * glyph edited.
   */
  newGlyphName(): GlyphName | null {
    const edited = this.#editor.editedGlyphCell.peek();
    const name = edited ? this.#editor.font.glyphName(edited.glyphId) : null;
    if (!name) return null;

    return this.#editor.font.nextAvailableGlyphName(`${name}.alt`);
  }

  /** Replaces the range at `index` of an alternate's condition, or adds one when `index` is null. */
  async setRange(
    alternateId: AlternateId,
    index: number | null,
    range: ConditionRange,
  ): Promise<void> {
    const condition = this.#condition(alternateId);
    if (!condition) return;

    await this.#setCondition(alternateId, withRange(condition, index, range));
  }

  /** Removes the range at `index` of an alternate's condition. */
  async removeRange(alternateId: AlternateId, index: number): Promise<void> {
    const condition = this.#condition(alternateId);
    if (!condition) return;

    await this.#setCondition(alternateId, withoutRange(condition, index));
  }

  /** Moves an alternate to `position` in the order they are tried. */
  async move(alternateId: AlternateId, position: number): Promise<void> {
    await this.#editor.font.editGlyphAlternate(alternateId, { kind: "move", move: position });
  }

  /** Removes an alternate; its glyph stays in the font. */
  async remove(alternateId: AlternateId): Promise<void> {
    await this.#editor.font.editGlyphAlternate(alternateId, { kind: "remove" });
  }

  async #setCondition(alternateId: AlternateId, condition: Condition): Promise<void> {
    await this.#editor.font.editGlyphAlternate(alternateId, { kind: "condition", condition });
  }

  #condition(alternateId: AlternateId): Condition | null {
    const edited = this.#editor.editedGlyphCell.peek();
    if (!edited) return null;

    const alternates = this.#editor.font.alternatesOf(edited.glyphId);
    return alternates.find((alternate) => alternate.id === alternateId)?.condition ?? null;
  }

  /** Why `alternate` never draws, as its row says it; null when it draws somewhere. */
  #neverUsedNote(
    alternate: GlyphAlternate,
    alternates: readonly GlyphAlternate[],
    neverUsed: readonly NeverUsedAlternate[],
  ): string | null {
    track(this.#editor.font.glyphEntriesCell);
    const found = neverUsed.find((entry) => entry.alternateId === alternate.id);
    if (!found) return null;

    switch (found.reason.kind) {
      case "outsideAxes":
        return "Never used: no location on the axes meets its condition.";
      case "covered": {
        const [first] = found.reason.by;
        const coverer = alternates.find((other) => other.id === first);
        const name = coverer ? this.#editor.font.glyphName(coverer.glyph) : null;
        return `Never used: ${name ?? "an alternate"} above always wins first. Drag it below.`;
      }
    }
  }
}
