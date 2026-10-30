/**
 * The test surface's actions, written once: vitest's `TestEditor` and the E2E
 * hook both run these, so a setup step means the same thing in both drivers.
 *
 * @remarks
 * Each action calls the public method the UI calls for it, named after the
 * surface's action. Callers wait for the workspace to confirm the edit:
 * `TestEditor` settles after each one, and the E2E hook bridge settles
 * before it answers.
 */
import type { Editor } from "@shift/editor";
import { sourceMetricValue, withSourceMetricValue } from "@shift/editor/model";
import type { SourceSelectionMode } from "@shift/editor/types";
import { externalAxisLocationFromRecord } from "@shift/editor/variation";
import type { Point2D } from "@shift/geo";
import type {
  AnchorId,
  AxisId,
  GlyphName,
  PointId,
  SelectableId,
  Source,
  Unicode,
} from "@shift/types";
import { drawFixture } from "./drawFixture";
import type { DrawOptions, GlyphFixture, PointNames } from "./fixtures";
import type { AxisFixture, AxisLocation } from "./fonts";

export class SurfaceActions {
  readonly #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  /** Draws `fixture` into the open glyph; see `drawFixture`. */
  draw<const F extends GlyphFixture>(
    fixture: F,
    options: DrawOptions = {},
  ): Promise<Record<PointNames<F>, PointId>> {
    return drawFixture(this.#editor, fixture, options);
  }

  /**
   * Adds the glyph `name`, encoded at `unicode` (or not encoded when null), as glyph creation
   * does, and loads it.
   *
   * @throws {Error} when the font's glyph metadata would name or encode the glyph otherwise.
   */
  async addGlyph(name: string, unicode: number | null): Promise<void> {
    const font = this.#editor.font;
    const record =
      unicode === null
        ? font.createGlyph(name as GlyphName)
        : font.createGlyphForUnicode(unicode as Unicode);
    const made = `${record.name} at ${record.unicodes.join() || "no Unicode"}`;
    const wanted = `${name} at ${unicode === null ? "no Unicode" : String(unicode)}`;
    if (made !== wanted) throw new Error(`Expected glyph ${wanted}; the font made ${made}`);
    // The glyph loads once the workspace has confirmed it exists.
    await font.editCoordinator.settled();
    await font.loadGlyph(record.id);
  }

  /** Adds the glyphs a language needs for `unicodes`, as the language panel does, and returns their names. */
  createGlyphsForUnicodes(unicodes: readonly number[]): string[] {
    return this.#editor.createGlyphsForUnicodes(unicodes as Unicode[]).map(({ name }) => name);
  }

  /** Adds a continuous axis, as the Axes panel creates one. */
  addAxis(axis: AxisFixture): void {
    this.#editor.font.createAxis({
      tag: axis.tag,
      name: axis.name ?? axis.tag,
      role: axis.role ?? "external",
      axisType: "continuous",
      minimum: axis.minimum,
      default: axis.default,
      maximum: axis.maximum,
      labels: [],
      hidden: false,
    });
  }

  /** Adds an unnamed anchor at `position` in the open glyph and selects it, as the anchor tool does. */
  addAnchorAt(position: Point2D): boolean {
    return this.#editor.addAnchorAt(position);
  }

  /** Renames the anchor `anchorId`, as the sidebar's name field does. */
  renameAnchor(anchorId: AnchorId, name: string): boolean {
    return this.#editor.renameAnchor(anchorId, name);
  }

  /** Deletes the axis tagged `tag`, as Settings › Axes does. */
  deleteAxis(tag: string): void {
    this.#editor.font.deleteAxis(this.#axisTagged(tag));
  }

  /**
   * Adds a source named `name` at `location`, keyed by axis tag, as the Create source menu does:
   * the editor moves there, the open glyph gets a layer there, and the source becomes active.
   */
  addSource(name: string, location: AxisLocation): void {
    this.#editor.createSource(name, externalAxisLocationFromRecord(this.#axisValues(location)));
  }

  /** Deletes the source named `name`, as the Sources panel does. */
  deleteSource(name: string): void {
    this.#editor.font.deleteSource(this.#sourceNamed(name).id);
  }

  /** Renames the source `source` to `name`, as Settings › Sources does. */
  async renameSource(source: string, name: string): Promise<void> {
    await this.#editor.font.updateSource({ ...this.#sourceNamed(source), name });
  }

  /** Sets the source `source`'s italic angle, as Settings › Sources does. */
  async setSourceItalicAngle(source: string, italicAngle: number): Promise<void> {
    await this.#editor.font.updateSource({ ...this.#sourceNamed(source), italicAngle });
  }

  /** Sets the source `source`'s line gap, as Settings › Sources does. */
  async setSourceLineGap(source: string, lineGap: number): Promise<void> {
    await this.#editor.font.updateSource({ ...this.#sourceNamed(source), lineGap });
  }

  /** Moves the metric named `metric` (`Ascender`, `x-Height`, …) in the source `source` to `position`. */
  async setSourceMetric(source: string, metric: string, position: number): Promise<void> {
    const font = this.#editor.font;
    const current = this.#sourceNamed(source);
    const definition = font.metricDefinitions.find((candidate) => candidate.name === metric);
    if (!definition) throw new Error(`The font has no metric named ${metric}`);
    const value = sourceMetricValue(current, definition.id);
    await font.updateSource(withSourceMetricValue(current, { ...value, position }));
  }

  /** Adds a named instance at `location`, keyed by axis tag, as Settings › Instances does. */
  addInstance(name: string, location: AxisLocation): void {
    this.#editor.font.createNamedInstance({
      name,
      location: { values: this.#axisValues(location) },
    });
  }

  /** Moves the editor to `location`, keyed by axis tag, as the location sliders do. */
  setLocation(location: AxisLocation): void {
    this.#editor.setExternalLocation(externalAxisLocationFromRecord(this.#axisValues(location)));
  }

  /** Shows and edits the source named `name`, as clicking its Sources row does; `toggle` adds or removes it. */
  clickSource(name: string, mode?: SourceSelectionMode): void {
    this.#editor.selectSourceForEditing(this.#sourceNamed(name).id, mode);
  }

  /**
   * Edits the sources `names` together, as clicking the first and Cmd-clicking the rest does,
   * and waits until their layers are matched to the active one.
   */
  async editSources(names: readonly string[]): Promise<void> {
    const [first, ...rest] = names.map((name) => this.#sourceNamed(name).id);
    if (!first) throw new Error("editSources needs at least one source");

    this.#editor.selectSourceForEditing(first);
    for (const sourceId of rest) this.#editor.selectSourceForEditing(sourceId, "toggle");
    await this.#editor.editingLayersMatched();
  }

  /** Selects the objects `ids`, replacing the selection, as clicking them in the Objects tab does. */
  selectObjects(ids: readonly SelectableId[]): void {
    this.#editor.selection.select(ids);
  }

  /** Sets the canvas zoom level, as the zoom menu does. */
  setZoom(zoom: number): void {
    this.#editor.setZoom(zoom);
  }

  /** Fits the open glyph in the canvas, as View › Zoom to Fit does. */
  zoomToFit(): void {
    this.#editor.zoomToFit();
  }

  #sourceNamed(name: string): Source {
    const source = this.#editor.font.sourceNamed(name);
    if (!source) throw new Error(`The font has no source named ${name}`);
    return source;
  }

  #axisTagged(tag: string): AxisId {
    const axis = this.#editor.font.axisTagged(tag);
    if (!axis) throw new Error(`The font has no axis tagged ${tag}`);
    return axis.id;
  }

  #axisValues(location: AxisLocation): Record<AxisId, number> {
    return Object.fromEntries(
      Object.entries(location).map(([tag, value]) => [this.#axisTagged(tag), value]),
    ) as Record<AxisId, number>;
  }
}
