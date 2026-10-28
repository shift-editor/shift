import type { Page } from "@playwright/test";
import type { ExternalAxisLocation } from "@shift/editor/types";
import type { Point2D } from "@shift/geo";
import type {
  AnchorId,
  AxisDefinition,
  AxisId,
  GlyphId,
  GlyphName,
  NamedInstanceId,
  PointId,
  SelectableId,
  SourceId,
  Unicode,
} from "@shift/types";
import type { ScratchContour } from "./types";

// Setup edits for specs whose subject is something else (the Grid, recovery, navigation). Each
// calls the public Font or Editor command the Settings, sources or canvas UI calls, then waits
// for the workspace to confirm it. A spec whose subject is the edit itself drives the UI instead.

/** One axis's coordinate in an external (user-space) location. */
export type AxisValues = Readonly<Record<AxisId, number>>;

/** Adds an axis, as Settings › Axes does, and returns its id. */
export async function createAxis(page: Page, axis: AxisDefinition): Promise<AxisId> {
  return page.evaluate(async (definition) => {
    const font = window.shift!.font;
    const axisId = font.createAxis(definition);
    await font.editCoordinator.settled();
    return axisId;
  }, axis);
}

/** Adds a source named `name` at `location`, as the sources panel does, and returns its id. */
export async function createSource(
  page: Page,
  name: string,
  location: AxisValues,
): Promise<SourceId> {
  return page.evaluate(
    async ({ sourceName, values }) => {
      const font = window.shift!.font;
      const external = new Map(Object.entries(values)) as unknown as ExternalAxisLocation;
      const sourceId = font.createSource(sourceName, external);
      await font.editCoordinator.settled();
      return sourceId;
    },
    { sourceName: name, values: location },
  );
}

/** Adds a named instance at `location`, as Settings › Instances does, and returns its id. */
export async function createNamedInstance(
  page: Page,
  instance: { name: string; postscriptName?: string; location: AxisValues },
): Promise<NamedInstanceId> {
  return page.evaluate(async ({ name, postscriptName, location }) => {
    const font = window.shift!.font;
    const instanceId = font.createNamedInstance({
      name,
      ...(postscriptName === undefined ? {} : { postscriptName }),
      location: { values: { ...location } },
    });
    await font.editCoordinator.settled();
    return instanceId;
  }, instance);
}

/**
 * Edits the source `sourceId` as Settings › Sources does: its name, italic angle and line gap,
 * and each metric named by kind in `metricOffsets` moved by that many units.
 */
export async function editSource(
  page: Page,
  sourceId: SourceId,
  edit: {
    name?: string;
    italicAngle?: number;
    lineGap?: number;
    metricOffsets?: Readonly<Record<string, number>>;
  },
): Promise<void> {
  await page.evaluate(
    async ({ id, change }) => {
      const font = window.shift!.font;
      const source = font.source(id);
      if (!source) throw new Error(`Expected source ${id}`);

      const offsets = new Map(
        Object.entries(change.metricOffsets ?? {}).map(([kind, offset]) => {
          const metric = font.metricDefinitions.find((definition) => definition.kind === kind);
          if (!metric) throw new Error(`Expected ${kind} metric`);
          return [metric.id, offset] as const;
        }),
      );
      await font.updateSource({
        ...source,
        ...(change.name === undefined ? {} : { name: change.name }),
        ...(change.italicAngle === undefined ? {} : { italicAngle: change.italicAngle }),
        ...(change.lineGap === undefined ? {} : { lineGap: change.lineGap }),
        metricValues: source.metricValues.map((value) => {
          const offset = offsets.get(value.metricId);
          return offset === undefined ? value : { ...value, position: value.position + offset };
        }),
      });
      await font.editCoordinator.settled();
    },
    { id: sourceId, change: edit },
  );
}

/** Multiplies every metric position of the source `sourceId` by `factor`, as Settings › Sources does. */
export async function scaleSourceMetrics(
  page: Page,
  sourceId: SourceId,
  factor: number,
): Promise<void> {
  await page.evaluate(
    async ({ id, scale }) => {
      const font = window.shift!.font;
      const source = font.sources.find((candidate) => candidate.id === id);
      if (!source || source.metricValues.length === 0) {
        throw new Error(`Expected metrics on source ${id}`);
      }
      await font.updateSource({
        ...source,
        metricValues: source.metricValues.map((value) => ({
          ...value,
          position: value.position * scale,
        })),
      });
      await font.editCoordinator.settled();
    },
    { id: sourceId, scale: factor },
  );
}

/** Deletes the source `sourceId`, as the sources panel does. */
export async function deleteSource(page: Page, sourceId: SourceId): Promise<void> {
  await page.evaluate(async (id) => {
    const font = window.shift!.font;
    font.deleteSource(id);
    await font.editCoordinator.settled();
  }, sourceId);
}

/** Deletes the axis `axisId`, as Settings › Axes does. */
export async function deleteAxis(page: Page, axisId: AxisId): Promise<void> {
  await page.evaluate(async (id) => {
    const font = window.shift!.font;
    font.deleteAxis(id);
    await font.editCoordinator.settled();
  }, axisId);
}

/** Moves the editor to `location`, as the location sliders do. */
export async function setLocation(page: Page, location: AxisValues): Promise<void> {
  await page.evaluate((values) => {
    window.shift!.editor.setExternalLocation(
      new Map(Object.entries(values)) as unknown as ExternalAxisLocation,
    );
  }, location);
}

/** Pastes `contours` into the open glyph, as Paste does, and returns the ids of the points it added. */
export async function insertContours(
  page: Page,
  contours: readonly ScratchContour[],
): Promise<readonly SelectableId[]> {
  return page.evaluate(async (content) => {
    const editor = window.shift!.editor;
    const inserted = editor.insertContent({
      contours: content.map((contour) => ({ ...contour, points: [...contour.points] })),
    });
    if (!inserted) throw new Error("Expected inserted contours");

    await editor.font.editCoordinator.settled();
    return inserted;
  }, contours);
}

/** Adds an anchor named `name` at `position` to the open glyph's layer, and returns its id. */
export async function addAnchor(page: Page, name: string, position: Point2D): Promise<AnchorId> {
  return page.evaluate(
    async ({ anchorName, at }) => {
      const workspace = window.shift!;
      const editor = workspace.editor;
      const node = editor.scene.nodesOfKind("glyph")[0];
      if (!node) throw new Error("Expected glyph node");
      const layer = editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId);
      if (!layer) throw new Error("Expected editable glyph layer");

      const anchorId = layer.addAnchor(anchorName, at);
      await workspace.font.editCoordinator.settled();
      return anchorId;
    },
    { anchorName: name, at: position },
  );
}

/** Creates empty glyphs named `names`, as Create glyph does, and returns each one's id and name. */
export async function createGlyphs(
  page: Page,
  names: readonly string[],
): Promise<{ id: GlyphId; name: string }[]> {
  return page.evaluate(async (glyphNames) => {
    const workspace = window.shift!;
    const records = glyphNames.map((name) => workspace.editor.createGlyph(name as GlyphName));
    await workspace.font.editCoordinator.settled();
    return records.map(({ id, name }) => ({ id, name }));
  }, names);
}

/** Creates the glyphs a language needs for `unicodes`, as the language panel does, and returns their names. */
export async function createGlyphsForUnicodes(
  page: Page,
  unicodes: readonly number[],
): Promise<string[]> {
  return page.evaluate(async (codepoints) => {
    const workspace = window.shift!;
    const glyphs = workspace.editor.createGlyphsForUnicodes(codepoints as Unicode[]);
    await workspace.font.editCoordinator.settled();
    return glyphs.map(({ name }) => name);
  }, unicodes);
}

/**
 * Creates the glyph named `name` with `advance` and `contours` at the default source, built
 * through its layer's own commands, without opening it, and returns its id.
 */
export async function createGlyphWithOutline(
  page: Page,
  name: string,
  advance: number,
  contours: readonly ScratchContour[],
): Promise<GlyphId> {
  return page.evaluate(
    async ({ glyphName, width, content }) => {
      const workspace = window.shift!;
      const record = workspace.editor.createGlyph(glyphName as GlyphName);
      await workspace.font.editCoordinator.settled();

      const glyph = await workspace.font.loadGlyph(record.id);
      const layer = glyph.layerForSource(workspace.font.defaultSource.id);
      if (!layer) throw new Error(`Expected an authored layer for ${glyphName}`);

      layer.setXAdvance(width);
      for (const contour of content) {
        const contourId = layer.addContour();
        for (const point of contour.points) layer.addPoint(contourId, point);
        if (contour.closed) layer.closeContour(contourId);
      }
      await workspace.font.editCoordinator.settled();
      return record.id;
    },
    { glyphName: name, width: advance, content: contours },
  );
}

/**
 * Moves the points an edit of `ids` matches in each other editing source by (40, 25) times the
 * source's place among them, through each matched layer's own command, so every source's
 * outline differs; throws unless `expectedSources` layers match completely.
 */
export async function offsetMatchedSourcePoints(
  page: Page,
  ids: readonly PointId[],
  expectedSources: number,
): Promise<void> {
  await page.evaluate(
    async ({ pointIds, expected }) => {
      const workspace = window.shift!;
      const targets = workspace.editor.positionSelection(pointIds)?.additionalLayers;
      if (targets?.length !== expected) {
        throw new Error(`Expected ${expected} matched source layers`);
      }
      for (const [index, target] of targets.entries()) {
        const points = target.targets.points;
        if (points?.length !== pointIds.length) throw new Error("Expected a complete point match");
        target.layer.movePoints(points, { x: 40 * (index + 1), y: 25 * (index + 1) });
      }
      await workspace.font.editCoordinator.settled();
    },
    { pointIds: ids, expected: expectedSources },
  );
}
