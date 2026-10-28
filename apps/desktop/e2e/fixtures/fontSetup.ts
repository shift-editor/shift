import type { Page } from "@playwright/test";
import type { ExternalAxisLocation } from "@shift/editor/types";
import type { AxisDefinition, AxisId, GlyphId, GlyphName, SourceId, Unicode } from "@shift/types";
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

/** Pastes `contours` into the open glyph, as Paste does, and returns how many contours it added. */
export async function insertContours(
  page: Page,
  contours: readonly ScratchContour[],
): Promise<number> {
  return page.evaluate(async (content) => {
    const editor = window.shift!.editor;
    const inserted = editor.insertContent({
      contours: content.map((contour) => ({ ...contour, points: [...contour.points] })),
    });
    if (!inserted) throw new Error("Expected inserted contours");

    await editor.font.editCoordinator.settled();
    return inserted.length;
  }, contours);
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
