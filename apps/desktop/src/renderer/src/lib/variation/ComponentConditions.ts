import type { Editor } from "@shift/editor";
import { computed, type Signal } from "@shift/editor/signals";
import { sameConditionRange } from "@shift/glyph-state";
import { isComponentId, type ConditionRange } from "@shift/types";
import type { SelectedComponentCondition } from "@/types/conditions";
import { ConditionChipSpace, sharedRanges } from "./ConditionChipSpace";

/**
 * The selected components' condition, as the component section's chips show
 * and change it: the ranges they all have, and whether they differ beyond
 * them (Mixed). Every edit applies to each selected component, the same in
 * every drawing of the glyph.
 *
 * @remarks
 * A condition is the same in every drawing, so this reads the drawing being
 * edited. It is read where the glyph the components sit in is drawn: the
 * font's axes and that glyph's own.
 */
export class ComponentConditions {
  readonly #editor: Editor;
  readonly #selectedCell: Signal<SelectedComponentCondition | null>;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#selectedCell = computed(() => {
      const ids = editor.selection.stateCell.value.ids;
      const edited = editor.editedGlyphCell.value;
      if (!edited || ids.length === 0 || !ids.every(isComponentId)) return null;

      const components = editor.selectedComponentsAtActiveSource();
      if (!components) return null;

      const parentGlyphId = edited.drawnGlyphId;
      const conditions = components.map((component) => component.condition);
      const shared = sharedRanges(conditions);
      const mixed = conditions.some((condition) => condition.all.length !== shared.length);
      const chips = new ConditionChipSpace(editor, parentGlyphId).chips({ all: shared });
      return { parentGlyphId, chips, mixed };
    });
  }

  /**
   * The selected components' shared chips; null unless the selection is
   * only components on the drawing being edited.
   */
  get selectedCell(): Signal<SelectedComponentCondition | null> {
    return this.#selectedCell;
  }

  /**
   * Gives every selected component `range`: in place of the shared range
   * `replacing` where it has it, else after its other ranges.
   *
   * @throws {Error} when the engine refuses the condition.
   */
  async setRange(replacing: ConditionRange | null, range: ConditionRange): Promise<void> {
    await this.#editor.setSelectedComponentsCondition((condition) => {
      const at = replacing
        ? condition.all.findIndex((other) => sameConditionRange(other, replacing))
        : -1;
      if (at < 0) return { all: [...condition.all, range] };

      return { all: condition.all.map((other, index) => (index === at ? range : other)) };
    });
  }

  /** Removes the shared range `range` from every selected component's condition. */
  async removeRange(range: ConditionRange): Promise<void> {
    await this.#editor.setSelectedComponentsCondition((condition) => ({
      all: condition.all.filter((other) => !sameConditionRange(other, range)),
    }));
  }
}
