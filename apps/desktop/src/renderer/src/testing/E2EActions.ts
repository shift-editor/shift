import type { Editor } from "@shift/editor";
import { externalAxisLocationFromRecord } from "@shift/editor/variation";
import type { Point2D } from "@shift/geo";
import type {
  AnchorId,
  AxisDefinition,
  AxisId,
  GlyphId,
  GlyphName,
  NamedInstanceId,
  PointId,
  SourceId,
  Unicode,
} from "@shift/types";
import { drawFixture } from "./drawFixture";
import type { DrawOptions, GlyphFixture, PointNames } from "./fixtures";

/** One axis's coordinate in an external (user-space) location, keyed by axis id. */
export type AxisValues = Readonly<Record<AxisId, number>>;

/** A named instance to add, at a location keyed by axis id. */
export interface InstanceDefinition {
  readonly name: string;
  readonly postscriptName?: string;
  readonly location: AxisValues;
}

/** An edit to one source, as Settings › Sources makes it. */
export interface SourceEdit {
  readonly name?: string;
  readonly italicAngle?: number;
  readonly lineGap?: number;
  /** Units to move each metric by, keyed by metric kind (`ascender`, `xHeight`, …). */
  readonly metricOffsets?: Readonly<Record<string, number>>;
}

/**
 * Setup actions for E2E specs whose subject is something else (the Grid, recovery,
 * navigation), run in the app's renderer through the E2E actions hook.
 *
 * @remarks
 * Each action calls the public `Editor` or `Font` command the UI calls, then
 * waits until the workspace confirms it, so a spec never settles edits itself.
 * A spec whose subject is the edit drives the UI instead. Loaded only for E2E
 * launches.
 */
export class E2EActions {
  readonly #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  /** Draws `fixture` into the open glyph, as `TestEditor.draw` does. */
  draw<const F extends GlyphFixture>(
    fixture: F,
    options: DrawOptions,
  ): Promise<Record<PointNames<F>, PointId>> {
    return drawFixture(this.#editor, fixture, options);
  }

  /** Adds an axis, as Settings › Axes does, and returns its id. */
  async createAxis(axis: AxisDefinition): Promise<AxisId> {
    const axisId = this.#editor.font.createAxis(axis);
    await this.#settle();
    return axisId;
  }

  /** Adds the source record `name` at `location`, as Settings › Sources does, and returns its id. */
  async createSource(name: string, location: AxisValues): Promise<SourceId> {
    const sourceId = this.#editor.font.createSource(name, externalAxisLocationFromRecord(location));
    await this.#settle();
    return sourceId;
  }

  /**
   * Adds a source at `location` as the sources panel's Create source menu does: the editor
   * moves there, gives the open glyph a layer there, and makes the new source active.
   */
  async createSourceHere(name: string, location: AxisValues): Promise<SourceId> {
    const sourceId = this.#editor.createSource(name, externalAxisLocationFromRecord(location));
    await this.#settle();
    return sourceId;
  }

  /** Adds a named instance, as Settings › Instances does, and returns its id. */
  async createNamedInstance(instance: InstanceDefinition): Promise<NamedInstanceId> {
    const { name, postscriptName, location } = instance;
    const instanceId = this.#editor.font.createNamedInstance({
      name,
      ...(postscriptName === undefined ? {} : { postscriptName }),
      location: { values: { ...location } },
    });
    await this.#settle();
    return instanceId;
  }

  /** Edits the source `sourceId`, as Settings › Sources does. */
  async editSource(sourceId: SourceId, edit: SourceEdit): Promise<void> {
    const font = this.#editor.font;
    const source = font.source(sourceId);
    if (!source) throw new Error(`The font has no source ${sourceId}`);

    const offsets = new Map(
      Object.entries(edit.metricOffsets ?? {}).map(([kind, offset]) => {
        const metric = font.metricDefinitions.find((definition) => definition.kind === kind);
        if (!metric) throw new Error(`The font has no ${kind} metric`);
        return [metric.id, offset] as const;
      }),
    );
    await font.updateSource({
      ...source,
      ...(edit.name === undefined ? {} : { name: edit.name }),
      ...(edit.italicAngle === undefined ? {} : { italicAngle: edit.italicAngle }),
      ...(edit.lineGap === undefined ? {} : { lineGap: edit.lineGap }),
      metricValues: source.metricValues.map((value) => {
        const offset = offsets.get(value.metricId);
        return offset === undefined ? value : { ...value, position: value.position + offset };
      }),
    });
    await this.#settle();
  }

  /** Multiplies every metric position of the source `sourceId` by `factor`, as Settings › Sources does. */
  async scaleSourceMetrics(sourceId: SourceId, factor: number): Promise<void> {
    const font = this.#editor.font;
    const source = font.source(sourceId);
    if (!source || source.metricValues.length === 0) {
      throw new Error(`The font has no metrics on source ${sourceId}`);
    }
    await font.updateSource({
      ...source,
      metricValues: source.metricValues.map((value) => ({
        ...value,
        position: value.position * factor,
      })),
    });
    await this.#settle();
  }

  /** Deletes the source `sourceId`, as the sources panel does. */
  async deleteSource(sourceId: SourceId): Promise<void> {
    this.#editor.font.deleteSource(sourceId);
    await this.#settle();
  }

  /** Deletes the axis `axisId`, as Settings › Axes does. */
  async deleteAxis(axisId: AxisId): Promise<void> {
    this.#editor.font.deleteAxis(axisId);
    await this.#settle();
  }

  /** Moves the editor to `location`, as the location sliders do. */
  setLocation(location: AxisValues): void {
    this.#editor.setExternalLocation(externalAxisLocationFromRecord(location));
  }

  /**
   * Creates the glyph `name`, encoded at `unicode` (or not encoded when null), loads it, and
   * returns its id.
   *
   * @remarks
   * Goes through the Font commands glyph creation calls: `createGlyphForUnicode` for an encoded
   * glyph, `createGlyph` otherwise. Both name or encode a glyph by the font's glyph metadata,
   * so a `name` and `unicode` they would not produce together throw rather than make a
   * different glyph.
   */
  async createGlyph(name: string, unicode: number | null): Promise<GlyphId> {
    const font = this.#editor.font;
    const record =
      unicode === null
        ? font.createGlyph(name as GlyphName)
        : font.createGlyphForUnicode(unicode as Unicode);
    const unicodes = [...record.unicodes];
    const expected = unicode === null ? [] : [unicode];
    if (record.name !== name || unicodes.join() !== expected.join()) {
      throw new Error(
        `Expected glyph ${name} at ${expected.join() || "no Unicode"}; the font made ${record.name} at ${unicodes.join() || "no Unicode"}`,
      );
    }
    await this.#settle();
    await font.loadGlyph(record.id);
    return record.id;
  }

  /** Creates the glyphs a language needs for `unicodes`, as the language panel does, and returns their names. */
  async createGlyphsForUnicodes(unicodes: readonly number[]): Promise<string[]> {
    const glyphs = this.#editor.createGlyphsForUnicodes(unicodes as Unicode[]);
    await this.#settle();
    return glyphs.map(({ name }) => name);
  }

  /**
   * Adds an anchor named `name` at `position` in the open glyph, as the anchor tool and the
   * sidebar's name field do, and returns its id.
   */
  async addAnchor(name: string, position: Point2D): Promise<AnchorId> {
    const editor = this.#editor;
    if (!editor.addAnchorAt(position)) throw new Error(`Could not add anchor ${name}`);

    const [anchorId] = editor.selection.ids;
    if (!anchorId) throw new Error(`Adding anchor ${name} selected nothing`);
    editor.renameAnchor(anchorId as AnchorId, name);
    await this.#settle();
    return anchorId as AnchorId;
  }

  /**
   * Moves the points matched to `ids` in each other source being edited by a different offset
   * per source, so the sources disagree, and waits for the edit.
   *
   * @remarks
   * No public command moves matched points in other sources apart from the active one, so this
   * moves each matched layer's points directly. It is setup for multi-source drag benchmarks.
   * @throws {Error} unless exactly `expectedSources` other layers match every point.
   */
  async offsetMatchedSourcePoints(ids: readonly PointId[], expectedSources: number): Promise<void> {
    const targets = this.#editor.positionSelection(ids)?.additionalLayers;
    if (targets?.length !== expectedSources) {
      throw new Error(`Expected ${expectedSources} matched source layers`);
    }
    for (const [index, target] of targets.entries()) {
      const points = target.targets.points;
      if (points?.length !== ids.length) throw new Error("Expected a complete point match");
      target.layer.movePoints(points, { x: 40 * (index + 1), y: 25 * (index + 1) });
    }
    await this.#settle();
  }

  async #settle(): Promise<void> {
    await this.#editor.font.editCoordinator.settled();
    await this.#editor.text.settled();
  }
}

/** The actions {@link E2EActions} serves, by the name an `e2e.act` call gives each. */
export type E2EActionName = {
  [M in keyof E2EActions]: E2EActions[M] extends (...args: never[]) => unknown ? M : never;
}[keyof E2EActions];

type ActionFunction<A extends E2EActionName> = Extract<
  E2EActions[A],
  (...args: never[]) => unknown
>;

/** The arguments the action `A` takes. */
export type E2EActionArgs<A extends E2EActionName> = Parameters<ActionFunction<A>>;

/** What the action `A` returns, awaited. */
export type E2EActionResult<A extends E2EActionName> = Awaited<ReturnType<ActionFunction<A>>>;
