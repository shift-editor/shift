import type { Editor } from "@shift/editor";
import type { Axis, Glyph } from "@shift/editor/model";
import { computed, track, type Signal } from "@shift/editor/signals";
import type { ExternalAxisLocation } from "@shift/editor/types";
import { asExternalAxisLocation, axisValue } from "@shift/editor/variation";
import type { Component } from "@shift/glyph-state";
import type { AxisId, LayerId } from "@shift/types";
import type { GlyphAxesSection, GlyphAxisDraft, GlyphSourceRow } from "@/types/glyphAxes";

/**
 * The glyph being edited, as the Designspace tab's Glyph sources and Glyph
 * axes sections show and change it: its own sources (drawings off the
 * font's sources), its own axes and where the canvas draws it on them.
 *
 * @remarks
 * Its cells follow the scene's single glyph node, so they read null while
 * none is edited.
 */
export class GlyphDesignspace {
  readonly #editor: Editor;
  readonly #axesCell: Signal<GlyphAxesSection | null>;
  readonly #sourcesCell: Signal<readonly GlyphSourceRow[] | null>;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#axesCell = computed(() => {
      const glyph = this.#editedGlyph();
      if (!glyph) return null;

      track(glyph.entryCell);
      const location = editor.glyphLocationCell.value;
      const rows = glyph.axesCell.value.map((axis) => ({ axis, value: axisValue(location, axis) }));
      return { glyphName: glyph.name, rows };
    });
    this.#sourcesCell = computed(() => {
      const glyph = this.#editedGlyph();
      if (!glyph) return null;

      const active = editor.activeDrawingCell.value;
      return glyph.locatedLayers.flatMap((layer) => {
        const location = glyph.drawingLocation(layer);
        if (!location) return [];

        return [
          { layerId: layer.id, name: glyph.space.locationName(location), active: layer === active },
        ];
      });
    });
  }

  /**
   * The Glyph axes section: one row per axis of the edited glyph, at the
   * value the canvas draws it at. Null while no single glyph is edited;
   * empty rows for a glyph with no axes of its own ("None").
   */
  get axesCell(): Signal<GlyphAxesSection | null> {
    return this.#axesCell;
  }

  /**
   * The Glyph sources section: the edited glyph's drawings off the font's
   * sources, brace drawings included, each named by where it sits. Null
   * while no single glyph is edited; empty for a glyph with none ("None").
   */
  get sourcesCell(): Signal<readonly GlyphSourceRow[] | null> {
    return this.#sourcesCell;
  }

  /** The edited glyph; null without exactly one glyph node. */
  get glyph(): Glyph | null {
    const node = this.#editor.scene.only("glyph");
    return node ? this.#editor.glyphForId(node.glyphId) : null;
  }

  /** The edited glyph's source row named `name`; null when it has none by that name. */
  sourceNamed(name: string): GlyphSourceRow | null {
    const rows = this.#sourcesCell.peek();
    if (!rows) return null;

    return rows.find((row) => row.name === name) ?? null;
  }

  /** The edited glyph's own axis tagged `tag`; null when it has none. */
  axisTagged(tag: string): Axis | null {
    return this.glyph?.axes.find((axis) => axis.tag === tag) ?? null;
  }

  /**
   * Moves where the canvas draws the edited glyph along one of its own axes,
   * clamped to the axis's range.
   *
   * @returns false when the axis is not one of the edited glyph's.
   */
  setAxis(axisId: AxisId, value: number): boolean {
    const axis = this.glyph?.axis(axisId) ?? null;
    if (!axis) return false;

    this.#editor.setGlyphAxisValue(axis, Math.min(axis.maximum, Math.max(axis.minimum, value)));
    return true;
  }

  /** Edits the glyph source `layerId`, moving the sliders to where it sits, as selecting a source does. */
  selectSource(layerId: LayerId): void {
    this.#editor.selectDrawing(layerId);
  }

  /**
   * Adds a glyph source to the edited glyph at `location` (font axes in user
   * units, the glyph's own in theirs), starting from the outline drawn
   * there, and edits it: the sliders move there and it is the one selected.
   *
   * @returns The new glyph source's layer id, or null when the glyph has a
   * source or glyph source there.
   */
  async addSourceAt(location: ExternalAxisLocation): Promise<LayerId | null> {
    const glyph = this.glyph;
    if (!glyph) return null;

    const onFontAxes = asExternalAxisLocation(
      new Map(location.entries().filter(([axisId]) => !glyph.space.hasAxis(axisId))),
    );
    this.#editor.setExternalLocation(onFontAxes);
    for (const axis of glyph.axes) this.#editor.setGlyphAxisValue(axis, axisValue(location, axis));
    const layerId = this.#editor.addDrawingHere();
    if (layerId) await this.#editor.font.editCoordinator.settled();
    return layerId;
  }

  /** Deletes one of the edited glyph's own sources. */
  async deleteSource(layerId: LayerId): Promise<void> {
    this.#editor.deleteDrawing(layerId);
    await this.#editor.font.editCoordinator.settled();
  }

  /**
   * Adds an axis to the edited glyph, its tag made from the name.
   *
   * @returns The new axis's id, or null with no single glyph edited.
   * @throws {Error} when the engine refuses the axis.
   */
  async addAxis(draft: GlyphAxisDraft): Promise<AxisId | null> {
    const glyph = this.glyph;
    if (!glyph) return null;

    return this.#editor.font.createGlyphAxis(glyph.id, {
      name: draft.name.trim(),
      tag: null,
      range: { minimum: draft.minimum, default: draft.default, maximum: draft.maximum },
    });
  }

  /**
   * Renames one of the edited glyph's axes and gives it a new range, each as
   * its own undo step, only where they changed. A range never moves a stored
   * value; one that would leave a value outside it is refused.
   *
   * @throws {Error} with the engine's reason when an edit is refused.
   */
  async updateAxis(axisId: AxisId, draft: GlyphAxisDraft): Promise<void> {
    const axis = this.glyph?.axis(axisId) ?? null;
    if (!axis) return;

    const font = this.#editor.font;
    const name = draft.name.trim();
    if (name !== axis.name) await font.editGlyphAxis(axisId, { kind: "name", name });

    const range = { minimum: draft.minimum, default: draft.default, maximum: draft.maximum };
    const unchanged =
      range.minimum === axis.minimum &&
      range.default === axis.kind.default &&
      range.maximum === axis.maximum;
    if (!unchanged) await font.editGlyphAxis(axisId, { kind: "range", range });
  }

  /**
   * Removes one of the edited glyph's axes.
   *
   * @throws {Error} naming each drawing and component that still sets it.
   */
  async removeAxis(axisId: AxisId): Promise<void> {
    const axis = this.glyph?.axis(axisId) ?? null;
    await this.#editor.font.editGlyphAxis(axisId, { kind: "remove" });
    // The glyph is no longer drawn along it.
    if (axis) this.#editor.setGlyphAxisValue(axis, axis.kind.default);
  }

  /** The own axes of the glyph every one of `components` draws; none when their bases differ. */
  sharedBaseAxes(components: readonly Component[]): readonly Axis[] {
    const bases = new Set(components.map((component) => component.baseGlyphId));
    const [base] = bases;
    if (bases.size !== 1 || !base) return [];

    return this.#editor.glyphForId(base)?.axes ?? [];
  }

  /** The edited glyph, subscribed to its node: for the cells. */
  #editedGlyph(): Glyph | null {
    const nodeCell = this.#editor.scene.onlyCell("glyph");
    track(nodeCell);
    const node = nodeCell.peek();
    return node ? this.#editor.glyphForId(node.glyphId) : null;
  }
}
