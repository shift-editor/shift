import type { Editor } from "@shift/editor";
import type { Axis } from "@shift/editor/model";
import type { ExternalAxisLocation } from "@shift/editor/types";
import { asExternalAxisLocation, axisValue } from "@shift/editor/variation";
import type { LayerId } from "@shift/types";
import type { GlyphDesignspace } from "@/lib/variation/GlyphDesignspace";
import { LocationDraft, type DraftIssue, type LocationDraftValues } from "./locationDraft";

/**
 * The New glyph source panel's form: one field per axis, the font's then
 * the edited glyph's own, read when the panel opens.
 */
export class GlyphSourceForm {
  readonly #editor: Editor;
  readonly #glyphs: GlyphDesignspace;
  /** The axes the panel has a field for, in field order. */
  readonly axes: readonly Axis[];

  constructor(editor: Editor, glyphs: GlyphDesignspace) {
    this.#editor = editor;
    this.#glyphs = glyphs;
    this.axes = [...editor.font.axesCell.peek(), ...(glyphs.glyph?.axes ?? [])];
  }

  /** The fields as the panel opens: where the sliders sit, font axes in user units, the glyph's own in theirs. */
  initialValues(): LocationDraftValues {
    const location = this.#editor.editLocation;
    return {
      name: "",
      location: Object.fromEntries(
        this.axes.map((axis) => [axis.id, String(axisValue(location, axis))]),
      ),
    };
  }

  /**
   * Why a glyph source can't be created at the typed location: a field that
   * is not a number or is outside its axis's range, or a source or glyph
   * source already there ("Spread 100 is already here").
   *
   * @returns null when Create may go ahead.
   */
  issue(values: LocationDraftValues["location"]): DraftIssue | null {
    const draft = new LocationDraft({ name: "", location: values });
    for (const axis of this.axes) {
      const value = draft.coordinate(axis);
      if (!Number.isFinite(value)) {
        return { kind: "axis", axisId: axis.id, message: `Enter a number for ${axis.name}` };
      }
      if (value < axis.minimum || value > axis.maximum) {
        return {
          kind: "axis",
          axisId: axis.id,
          message: `${axis.name} must be between ${axis.minimum} and ${axis.maximum}`,
        };
      }
    }

    const glyph = this.#glyphs.glyph;
    if (!glyph) return null;

    const occupant = glyph.sourceNameAt(this.#location(draft));
    return occupant ? { kind: "location", message: `${occupant} is already here` } : null;
  }

  /**
   * Adds a glyph source at the typed location, starting from the outline
   * drawn there, and edits it: the sliders move there and it is selected.
   *
   * @returns The new glyph source's layer id, or null when a field is
   * invalid or the location is taken.
   */
  async create(values: LocationDraftValues["location"]): Promise<LayerId | null> {
    if (this.issue(values)) return null;

    const draft = new LocationDraft({ name: "", location: values });
    return this.#glyphs.addSourceAt(this.#location(draft));
  }

  #location(draft: LocationDraft): ExternalAxisLocation {
    return asExternalAxisLocation(
      new Map(this.axes.map((axis) => [axis.id, draft.coordinate(axis)])),
    );
  }
}
