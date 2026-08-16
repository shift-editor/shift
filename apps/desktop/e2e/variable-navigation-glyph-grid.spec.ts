import type { Page } from "@playwright/test";
import type { AxisId, GlyphId, GlyphName, NamedInstanceId, SourceId } from "@shift/types";
import { expect, test } from "./fixtures/perfApp";
import {
  editorShell,
  glyphProperties,
  openCatalogGlyph,
  variationControls,
} from "./fixtures/appLocators";

interface VariableNavigationFixture {
  axisId: AxisId;
  firstGlyphId: GlyphId;
  secondGlyphId: GlyphId;
  regularSourceId: SourceId;
  boldSourceId: SourceId;
  instanceId: NamedInstanceId;
}

async function createVariableNavigationFixture(page: Page): Promise<VariableNavigationFixture> {
  return page.evaluate(async () => {
    const workspace = window.shift;
    if (!workspace) throw new Error("Expected authored workspace");

    const { editor, font } = workspace;
    const first = editor.createGlyph("navigationVariable" as GlyphName);
    const second = editor.createGlyph("navigationSparse" as GlyphName);
    await font.editCoordinator.settled();
    const [firstGlyph, secondGlyph] = await font.loadGlyphs([first.id, second.id]);
    if (!firstGlyph || !secondGlyph) throw new Error("Expected navigation glyphs");

    const regularSourceId = font.defaultSource.id;
    const firstRegular = firstGlyph.layerForSource(regularSourceId);
    const secondRegular = secondGlyph.layerForSource(regularSourceId);
    if (!firstRegular || !secondRegular) throw new Error("Expected regular layers");

    for (const layer of [firstRegular, secondRegular]) {
      const contourId = layer.addContour();
      for (const point of [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ]) {
        layer.addPoint(contourId, { ...point, pointType: "onCurve", smooth: false });
      }
      layer.closeContour(contourId);
      layer.setXAdvance(400);
    }
    await font.editCoordinator.settled();

    const axisId = font.createAxis({
      tag: "navw",
      name: "Navigation Weight",
      role: "external",
      axisType: "continuous",
      minimum: 100,
      default: 400,
      maximum: 900,
      labels: [],
      hidden: false,
    });
    await font.editCoordinator.settled();
    const boldLocation = new Map([[axisId, 900]]);
    const boldSourceId = font.createSource("Navigation Bold", boldLocation);
    await font.editCoordinator.settled();
    font.materializeGlyphLayer(
      firstGlyph.id,
      boldSourceId,
      firstRegular.id,
      firstGlyph.geometryAt(boldLocation).values,
    );
    await font.editCoordinator.settled();

    const firstBold = firstGlyph.layerForSource(boldSourceId);
    const firstPoint = firstBold?.allPoints[0];
    if (!firstBold || !firstPoint) throw new Error("Expected Navigation Bold layer");
    firstBold.applyPositionPatch([
      { kind: "point", id: firstPoint.id, x: firstPoint.x + 80, y: firstPoint.y + 40 },
    ]);
    firstBold.setXAdvance(700);

    const instanceId = font.createNamedInstance({
      name: "Navigation Preview",
      location: { values: { [axisId]: 700 } },
    });
    await font.editCoordinator.settled();
    return {
      axisId,
      firstGlyphId: first.id,
      secondGlyphId: second.id,
      regularSourceId,
      boldSourceId,
      instanceId,
    };
  });
}

async function expectPreview(
  page: Page,
  fixture: VariableNavigationFixture,
  expected: {
    location: number;
    activeSourceId: SourceId | null;
    xAdvance: number;
    firstPoint: { x: number; y: number };
  },
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        ({ axisId, glyphId }) => {
          const workspace = window.shift;
          const glyph = workspace?.editor.glyphForId(glyphId);
          const geometry = glyph?.geometryAt(workspace.editor.externalLocation);
          const point = geometry?.allPoints[0];
          return {
            location: workspace?.editor.externalLocation.get(axisId),
            activeSourceId: workspace?.editor.activeSourceId,
            xAdvance: geometry?.xAdvance,
            firstPoint: point && { x: point.x, y: point.y },
          };
        },
        { axisId: fixture.axisId, glyphId: fixture.firstGlyphId },
      ),
    )
    .toEqual(expected);
}

test("keeps variable preview and exact-source editability coherent across Grid navigation", async ({
  page,
}) => {
  await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);
  await expect.poll(() => page.evaluate(() => Boolean(window.shift?.font.loaded))).toBe(true);
  const fixture = await createVariableNavigationFixture(page);

  await page.getByRole("button", { name: "Axes", exact: true }).click();
  const axisInput = page.getByLabel("Navigation Weight value", { exact: true });
  await axisInput.click();
  await axisInput.fill("650");
  await axisInput.press("Enter");
  await expect
    .poll(() =>
      page.evaluate((axisId) => {
        const axisIndex = window.shift?.font.getAxes().findIndex(({ id }) => id === axisId) ?? -1;
        return {
          location: window.shiftSession?.catalog.locationCell.value[axisIndex],
          sourceId: window.shiftSession?.catalog.sourceIdCell.value,
        };
      }, fixture.axisId),
    )
    .toEqual({ location: 650, sourceId: null });

  await openCatalogGlyph(page, "navigationVariable", fixture.firstGlyphId);
  await expectPreview(page, fixture, {
    location: 650,
    activeSourceId: null,
    xAdvance: 550,
    firstPoint: { x: 40, y: 20 },
  });

  await page.getByTestId(`instance-${fixture.instanceId}`).click();
  await expectPreview(page, fixture, {
    location: 700,
    activeSourceId: null,
    xAdvance: 580,
    firstPoint: { x: 48, y: 24 },
  });

  await page.getByTestId(`source-${fixture.boldSourceId}`).click();
  await expect
    .poll(() => page.evaluate(() => window.shift?.editor.activeSourceId))
    .toBe(fixture.boldSourceId);
  const advanceInput = glyphProperties(page).getByLabel("Advance width", { exact: true });
  await expect(advanceInput).toBeEnabled();
  await advanceInput.click();
  await advanceInput.fill("760");
  await advanceInput.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        ({ glyphId, sourceId }) =>
          window.shift?.editor.glyphForId(glyphId)?.layerForSource(sourceId)?.xAdvance,
        { glyphId: fixture.firstGlyphId, sourceId: fixture.boldSourceId },
      ),
    )
    .toBe(760);
  await expect
    .poll(() =>
      page.evaluate(
        ({ glyphId, sourceId }) =>
          window.shift?.editor.glyphForId(glyphId)?.layerForSource(sourceId)?.xAdvance,
        { glyphId: fixture.firstGlyphId, sourceId: fixture.regularSourceId },
      ),
    )
    .toBe(400);

  await editorShell(page).getByLabel("Display all glyphs").click();
  await page.waitForURL(/#\/home$/);
  await expect
    .poll(() =>
      page.evaluate((axisId) => window.shift?.editor.externalLocation.get(axisId), fixture.axisId),
    )
    .toBe(700);

  await openCatalogGlyph(page, "navigationSparse", fixture.secondGlyphId);
  await expect
    .poll(() =>
      page.evaluate(
        ({ glyphId, sourceId }) =>
          window.shift?.editor.glyphForId(glyphId)?.layerForSource(sourceId) ?? null,
        { glyphId: fixture.secondGlyphId, sourceId: fixture.boldSourceId },
      ),
    )
    .toBeNull();
  await expect(glyphProperties(page).getByLabel("Advance width", { exact: true })).toBeDisabled();

  await page.getByTestId(`source-${fixture.boldSourceId}`).click();
  await expect
    .poll(() =>
      page.evaluate(
        ({ glyphId, sourceId }) =>
          window.shift?.editor.glyphForId(glyphId)?.layerForSource(sourceId)?.sourceId,
        { glyphId: fixture.secondGlyphId, sourceId: fixture.boldSourceId },
      ),
    )
    .toBe(fixture.boldSourceId);
  await expect(glyphProperties(page).getByLabel("Advance width", { exact: true })).toBeEnabled();

  const editorAxisInput = variationControls(page).getByLabel("Navigation Weight value", {
    exact: true,
  });
  await editorAxisInput.click();
  await editorAxisInput.fill("650");
  await editorAxisInput.press("Enter");
  await expect.poll(() => page.evaluate(() => window.shift?.editor.activeSourceId)).toBeNull();
  await expect(glyphProperties(page).getByLabel("Advance width", { exact: true })).toBeDisabled();

  await editorShell(page).getByLabel("Display all glyphs").click();
  await page.waitForURL(/#\/home$/);
  await openCatalogGlyph(page, "navigationVariable", fixture.firstGlyphId);
  await expectPreview(page, fixture, {
    location: 650,
    activeSourceId: null,
    xAdvance: 580,
    firstPoint: { x: 40, y: 20 },
  });
});
