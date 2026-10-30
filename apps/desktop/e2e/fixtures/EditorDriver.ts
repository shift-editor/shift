import { expect, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import type { Point2D, Rect2D } from "@shift/geo";
import type {
  AuthoredAnchor,
  AuthoredContour,
  AuthoredComponent,
  AuthoredLayer,
  AuthoredPoint,
  KerningGroupSummary,
  KerningMasterValue,
} from "@shift/runtime";
import type {
  AnchorId,
  SelectableId,
  GlyphId,
  GlyphName,
  KerningPosition,
  PointId,
  Axis,
  NamedInstance,
  Source,
} from "@shift/types";
import {
  localPoint,
  screenVector,
  type LocalPoint,
  type ScenePoint,
  type ScreenPoint,
  type ScreenVector,
} from "@shift/editor/spaces";
import type { PositionGuide, SourceSelectionMode } from "@shift/editor/types";
import type { MatchedPoint, SelectedObject } from "@/agent/ShiftEditorReader";
import type { AppReaders } from "@/agent/AppReaders";
import type {
  AnchorReadOptions,
  AxisSelection,
  CanvasHandle,
  CanvasText,
  DocumentSaveState,
  EditorActions,
  EditorReads,
  EditorViewState,
  FontSummary,
  GlyphListing,
  InstanceSelection,
  LocationSummary,
  Outline,
  OutlineTarget,
  PointReadOptions,
  SourceLayer,
  SourceSelection,
  SpacingToolState,
} from "@/testing/reads";
import type { E2EHooks } from "@/testing/e2e/hooks";
import type { DrawOptions, GlyphFixture, PointNames } from "@/testing/fixtures";
import { hooksOf, readsOf, registerApp, type Remote } from "./appHooks";
import { openVariationControls, sourceRow, waitForEditorReady } from "./appLocators";
import type { AxisFixture, AxisLocation } from "@/testing/fonts";
import type { ActiveGlyph, CanvasBounds, CanvasDrag, PointDrag, PointTarget } from "./types";

const TOOL_LABELS = {
  select: "Select Tool (V)",
  pen: "Pen Tool (P)",
  hand: "Hand Tool (H)",
  rectangle: "Rectangle Tool (R)",
  ellipse: "Ellipse Tool (O)",
  text: "Text Tool (T)",
  spacing: "Spacing Tool (S)",
} as const;

/** Toolbar tool actions the driver can locate and activate. */
export type EditorTool = keyof typeof TOOL_LABELS;

async function waitForActiveGlyph(page: Page, glyphId: GlyphId): Promise<void> {
  await expect
    .poll(async () => (await readsOf(page).editor.inspect("")).glyph?.glyphId)
    .toBe(glyphId);
}

/**
 * Drives the real desktop editor through Playwright and reads its observable domain state.
 *
 * @remarks
 * User actions that can persist geometry wait for the workspace edit pipeline before returning.
 * The {@link EditorReads} reads call the window's app readers, the read layer agents read too, through
 * MCP, over the app's E2E read hook (`globalThis.shiftAppReads`), with the same reader calls
 * and selectors as the vitest surface makes in-process. Live gesture observations remain
 * available through methods such as {@link selectionBounds}.
 */
export class EditorDriver implements EditorReads, EditorActions {
  /**
   * Creates a driver for the editor owned by `page`.
   * @param app - The app that owns `page`, when the E2E fixtures did not launch it; reads and
   *   setup find a fixture-launched page's app on their own.
   */
  constructor(
    readonly page: Page,
    app: ElectronApplication | null = null,
  ) {
    if (app) registerApp(app);
  }

  /** Returns the interactive editor canvas locator. */
  get canvas(): Locator {
    return this.page.locator("#interactive-canvas");
  }

  /** Returns the editor shell locator that publishes gesture state. */
  get shell(): Locator {
    return this.page.getByTestId("editor-shell");
  }

  /**
   * Opens the glyph mapped to `hexCodepoint`; throws when none exists.
   * @param hexCodepoint - Hexadecimal scalar value, such as `41` for `A`.
   */
  async openGlyphByUnicode(hexCodepoint: string): Promise<void> {
    const unicode = Number.parseInt(hexCodepoint, 16);
    await expect
      .poll(() => this.#reads.font.glyphForUnicode(unicode), { timeout: 20_000 })
      .not.toBeNull();
    const glyph = await this.#reads.font.glyphForUnicode(unicode);
    if (!glyph) throw new Error(`No glyph found for U+${hexCodepoint}`);
    const glyphId = glyph.id;

    await this.#hooks.session.openGlyph(glyphId);
    await waitForEditorReady(this.page, glyphId);
    await waitForActiveGlyph(this.page, glyphId);
    await this.waitForCanvasRender();
  }

  /**
   * Opens the exact named glyph; throws when none exists.
   * @param name - Glyph name in the loaded workspace.
   */
  async openGlyphByName(name: string): Promise<void> {
    const glyph = await this.glyphNamed(name);
    if (!glyph) throw new Error(`Expected ${name} glyph`);

    await this.openGlyph(glyph.id);
  }

  /**
   * Opens a known glyph and waits for scene publication.
   * @param glyphId - Glyph identity in the loaded workspace.
   */
  async openGlyph(glyphId: GlyphId): Promise<void> {
    await this.#hooks.session.openGlyph(glyphId);
    await waitForEditorReady(this.page, glyphId);
    await waitForActiveGlyph(this.page, glyphId);
  }

  /**
   * Builds `fixture` into the open glyph through the editor's own commands, as the vitest
   * surface's `draw` does.
   *
   * @remarks
   * The drawing is undoable like any edit: the engine keeps its own undo
   * stack, which setup cannot yet opt out of. Undo only what the test did.
   *
   * @param options - `select` selects every point drawn, in drawing order;
   * otherwise nothing is selected afterwards.
   * @returns the minted point ids, keyed by each point's `name`.
   */
  async draw<const F extends GlyphFixture>(
    fixture: F,
    options: DrawOptions = {},
  ): Promise<Record<PointNames<F>, PointId>> {
    // The hook call drops `draw`'s generic; the ids are keyed by the fixture's own names.
    return (await this.#hooks.actions.draw(fixture, options)) as Record<PointNames<F>, PointId>;
  }

  /**
   * Adds the glyph named `name`, encoded at `unicode`, and loads it, as vitest's `addGlyph`
   * does; throws when the font's glyph metadata would name or encode it otherwise.
   */
  async addGlyph(name: string, unicode: number | null): Promise<void> {
    await this.#hooks.actions.addGlyph(name, unicode);
  }

  /** Adds the glyphs a language needs for `unicodes`, as the language panel does, and returns their names. */
  async createGlyphsForUnicodes(unicodes: readonly number[]): Promise<string[]> {
    return this.#hooks.actions.createGlyphsForUnicodes(unicodes);
  }

  /** Adds a continuous axis, as the Create axis menu does, and waits for it. */
  async addAxis(axis: AxisFixture): Promise<void> {
    await this.#hooks.actions.addAxis(axis);
  }

  /** Deletes the axis tagged `tag`, as Settings › Axes does. */
  async deleteAxis(tag: string): Promise<void> {
    await this.#hooks.actions.deleteAxis(tag);
  }

  /**
   * Adds a source named `name` at `location`, keyed by axis tag, as the Create source menu does,
   * and waits for it: the editor moves there and the new source becomes active.
   */
  async addSource(name: string, location: AxisLocation): Promise<void> {
    await this.#hooks.actions.addSource(name, location);
  }

  /** Deletes the source named `name`, as the Sources panel does. */
  async deleteSource(name: string): Promise<void> {
    await this.#hooks.actions.deleteSource(name);
  }

  /** Renames the source `source` to `name`, as Settings › Sources does. */
  async renameSource(source: string, name: string): Promise<void> {
    await this.#hooks.actions.renameSource(source, name);
  }

  /** Sets the source `source`'s italic angle, as Settings › Sources does. */
  async setSourceItalicAngle(source: string, italicAngle: number): Promise<void> {
    await this.#hooks.actions.setSourceItalicAngle(source, italicAngle);
  }

  /** Sets the source `source`'s line gap, as Settings › Sources does. */
  async setSourceLineGap(source: string, lineGap: number): Promise<void> {
    await this.#hooks.actions.setSourceLineGap(source, lineGap);
  }

  /** Moves the metric named `metric` in the source `source` to `position`, as Settings › Sources does. */
  async setSourceMetric(source: string, metric: string, position: number): Promise<void> {
    await this.#hooks.actions.setSourceMetric(source, metric, position);
  }

  /** Adds a named instance at `location`, keyed by axis tag, as Settings › Instances does. */
  async addInstance(name: string, location: AxisLocation): Promise<void> {
    await this.#hooks.actions.addInstance(name, location);
  }

  /** Moves the editor to `location`, keyed by axis tag, as the location sliders do. */
  async setLocation(location: AxisLocation): Promise<void> {
    await this.#hooks.actions.setLocation(location);
  }

  /** Edits the sources `names` together and waits until their layers are matched. */
  async editSources(names: readonly string[]): Promise<void> {
    await this.#hooks.actions.editSources(names);
  }

  /** Selects the objects `ids`, replacing the selection, as clicking them in the Objects tab does. */
  async selectObjects(ids: readonly SelectableId[]): Promise<void> {
    await this.#hooks.actions.selectObjects(ids);
  }

  /** Sets the canvas zoom level, as the zoom menu does. */
  async setZoom(zoom: number): Promise<void> {
    await this.#hooks.actions.setZoom(zoom);
  }

  /** Fits the open glyph in the canvas, as View › Zoom to Fit does. */
  async zoomToFit(): Promise<void> {
    await this.#hooks.actions.zoomToFit();
  }

  /** Adds an unnamed anchor at `position` in the open glyph and selects it, as the anchor tool does. */
  async addAnchorAt(position: Point2D): Promise<boolean> {
    return this.#hooks.actions.addAnchorAt(position);
  }

  /** Renames the anchor `anchorId`, as the sidebar's name field does. */
  async renameAnchor(anchorId: AnchorId, name: string): Promise<boolean> {
    return this.#hooks.actions.renameAnchor(anchorId, name);
  }

  /**
   * Selects a toolbar tool by stable identity.
   * @param tool - Primary tool action to activate.
   */
  async selectTool(tool: EditorTool): Promise<void> {
    await this.toolButton(tool).click();
  }

  /**
   * Returns the toolbar button for a tool; its `aria-pressed` state reports activation.
   * @param tool - Primary tool action whose button is located.
   */
  toolButton(tool: EditorTool): Locator {
    return this.page.getByRole("button", { name: TOOL_LABELS[tool], exact: true });
  }

  /** Waits for pending edits and two browser frames to reach the canvas. */
  async waitForCanvasRender(): Promise<void> {
    await this.#waitForEdits();
    await this.canvas.waitFor({ state: "visible" });
    // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- waits for paint, not app state
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
  }

  /** Returns fresh page-space canvas bounds; throws before canvas rendering. */
  async canvasBounds(): Promise<CanvasBounds> {
    const bounds = await this.canvas.boundingBox();
    if (!bounds) throw new Error("Expected interactive canvas bounds");

    return bounds;
  }

  /** Projects a scene position into canvas-local coordinates. */
  async projectSceneToCanvas(position: ScenePoint): Promise<ScreenPoint> {
    return this.#hooks.canvas.sceneToCanvas(position);
  }

  /**
   * Projects a scene position into Playwright page coordinates.
   * @param position - Editor scene position.
   */
  async projectSceneToPage(position: ScenePoint): Promise<Point2D> {
    const [canvasPosition, bounds] = await Promise.all([
      this.projectSceneToCanvas(position),
      this.canvasBounds(),
    ]);
    return { x: bounds.x + canvasPosition.x, y: bounds.y + canvasPosition.y };
  }

  /**
   * Projects a position in the open glyph's own units into Playwright page coordinates.
   * @param position - Glyph-local position, such as a value from {@link selectionBounds}.
   */
  async projectGlyphToPage(position: LocalPoint): Promise<Point2D> {
    const [canvasPosition, bounds] = await Promise.all([
      this.#hooks.canvas.glyphToCanvas(position),
      this.canvasBounds(),
    ]);
    return { x: bounds.x + canvasPosition.x, y: bounds.y + canvasPosition.y };
  }

  /** Projects a position in the open glyph's own units into canvas-local coordinates. */
  async projectGlyphToCanvas(position: LocalPoint): Promise<ScreenPoint> {
    return this.#hooks.canvas.glyphToCanvas(position);
  }

  /** Projects a canvas-local position into the open glyph's own units. */
  async projectCanvasToGlyph(position: ScreenPoint): Promise<LocalPoint> {
    return this.#hooks.canvas.canvasToGlyph(position);
  }

  /**
   * Projects a canvas-local position into scene coordinates.
   * @param position - Point relative to the canvas origin.
   */
  async projectCanvasToScene(position: ScreenPoint): Promise<ScenePoint> {
    return this.#hooks.canvas.canvasToScene(position);
  }

  /** Selects every editable object and waits for any resulting workspace edits. */
  async selectAll(): Promise<void> {
    await this.press("ControlOrMeta+a");
  }

  /** Undoes the latest editor command and waits for confirmed workspace geometry. */
  async undo(): Promise<void> {
    await this.press("ControlOrMeta+z");
  }

  /** Redoes the latest editor command and waits for confirmed workspace geometry. */
  async redo(): Promise<void> {
    await this.press("ControlOrMeta+Shift+z");
  }

  /**
   * Sends a keyboard chord and waits for persisted edits.
   * @param key - Playwright chord delivered to the workspace.
   */
  async press(key: string): Promise<void> {
    await this.page.keyboard.press(key);
    await this.#waitForEdits();
  }

  /**
   * Replaces a numeric or text field's value, commits it with Enter, and waits for edits.
   * @param input - Editable field in the workspace window.
   * @param value - Replacement typed into the field.
   */
  async commitInputValue(input: Locator, value: number | string): Promise<void> {
    await input.click();
    await input.fill(String(value));
    await this.press("Enter");
  }

  /**
   * Starts a pointer gesture at an absolute page position.
   * @param position - Point in Playwright page coordinates.
   */
  async pointerDown(position: Point2D): Promise<void> {
    await this.page.mouse.move(position.x, position.y);
    await this.page.mouse.down();
  }

  /**
   * Advances and flushes the active pointer gesture.
   * @param position - Destination in Playwright page coordinates.
   * @param steps - Number of intermediate browser samples.
   */
  async pointerMove(position: Point2D, steps = 1): Promise<void> {
    await this.page.mouse.move(position.x, position.y, { steps });
    await this.flushPointerMoves();
  }

  /** Completes the active pointer gesture and waits for confirmed edits. */
  async pointerUp(): Promise<void> {
    await this.page.mouse.up();
    await this.waitForIdle();
  }

  /**
   * Drags between canvas-local points and waits for confirmed edits.
   * @param input - Endpoints, held modifiers, and browser sample count.
   */
  async dragCanvas(input: CanvasDrag): Promise<void> {
    const bounds = await this.canvasBounds();
    const from = { x: bounds.x + input.from.x, y: bounds.y + input.from.y };
    const to = { x: bounds.x + input.to.x, y: bounds.y + input.to.y };
    const modifiers = input.modifiers;

    let pressed = false;
    for (const modifier of modifiers) await this.page.keyboard.down(modifier);
    try {
      await this.pointerDown(from);
      pressed = true;
      await this.pointerMove(to, input.steps ?? 5);
      await this.pointerUp();
      pressed = false;
    } finally {
      if (pressed) await this.page.mouse.up();
      for (const modifier of [...modifiers].reverse()) await this.page.keyboard.up(modifier);
    }
  }

  /** Cancels the active pointer gesture and waits for rollback to complete. */
  async cancelGesture(): Promise<void> {
    await this.page.keyboard.press("Escape");
    await this.page.mouse.up();
    await this.waitForIdle();
  }

  /** Flushes the latest coalesced pointer move into the active tool gesture. */
  async flushPointerMoves(): Promise<void> {
    await this.#hooks.canvas.flushPointerMoves();
  }

  /** Waits until the current gesture and its workspace edits are complete. */
  async waitForIdle(): Promise<void> {
    await expect(this.shell).toHaveAttribute("data-gesture", "idle", { timeout: 30_000 });
    await this.#waitForEdits();
  }

  /** Returns the glyph being edited, or null when none is (or its authored layer is not published). */
  async activeGlyph(): Promise<ActiveGlyph | null> {
    const [[nodeId], { glyph }] = await Promise.all([
      this.#reads.editor.editingNodeIds(),
      this.editorView(),
    ]);
    if (!glyph || glyph.nodeId !== nodeId) return null;

    const layer = await this.#reads.font.getLayer({
      glyph: { glyphId: glyph.glyphId },
      source: { sourceId: glyph.sourceId },
    });
    return {
      glyphId: glyph.glyphId,
      nodeId: glyph.nodeId,
      sourceId: glyph.sourceId,
      pointCount: layer.contours.reduce((count, contour) => count + contour.points.length, 0),
      contourCount: layer.contours.length,
    };
  }

  /** Returns zero without an active glyph, otherwise its authored point count. */
  async pointCount(): Promise<number> {
    return (await this.activeGlyph())?.pointCount ?? 0;
  }

  /** Returns zero without an active glyph, otherwise its authored contour count. */
  async contourCount(): Promise<number> {
    return (await this.activeGlyph())?.contourCount ?? 0;
  }

  /** Returns the canvas zoom level. */
  async zoomLevel(): Promise<number> {
    return (await this.#reads.editor.camera()).zoom;
  }

  /** Returns how far the canvas is panned, in screen pixels. */
  async canvasOffset(): Promise<ScreenVector> {
    const { pan } = await this.#reads.editor.camera();
    return screenVector(pan.x, pan.y);
  }

  /** Returns the ids of the scene nodes being edited, in the order they were entered. */
  async editedNodeIds(): Promise<readonly string[]> {
    return this.#reads.editor.editingNodeIds();
  }

  /** Returns the hovered editor object identity, or null when nothing is hovered. */
  async hoverId(): Promise<string | null> {
    return this.#reads.editor.hoveredId();
  }

  /** Returns the active tool's published state discriminator. */
  async toolState(): Promise<string | null> {
    return (await this.editorView()).tool?.state ?? null;
  }

  /** Returns fresh live selection bounds in glyph units; throws without a bounded selection. */
  async selectionBounds(): Promise<Rect2D> {
    const b = await this.#reads.editor.selectionBounds();
    if (!b) throw new Error("Expected selection bounds");

    return {
      x: b.min.x,
      y: b.min.y,
      width: b.max.x - b.min.x,
      height: b.max.y - b.min.y,
      left: b.min.x,
      top: b.min.y,
      right: b.max.x,
      bottom: b.max.y,
    };
  }

  /**
   * Returns fresh interaction targets; throws when a point is absent.
   * @param pointIds - Active-layer point identities in desired order.
   */
  async pointTargets(pointIds: readonly PointId[]): Promise<readonly PointTarget[]> {
    await this.#waitForEdits();

    return this.#hooks.canvas.pointProjections(pointIds);
  }

  /** The open glyph's point `id` as the canvas draws it now, a gesture's preview included; null when it draws none. */
  async drawnPoint(id: PointId): Promise<AuthoredPoint | null> {
    return this.#pointIn(await this.drawnOutline(), id);
  }

  /**
   * Selects one point through its rendered position; throws when absent.
   * @param pointId - Point in the active authored layer.
   */
  async clickPoint(pointId: PointId): Promise<void> {
    const [target] = await this.pointTargets([pointId]);

    await this.page.mouse.click(target.pagePosition.x, target.pagePosition.y);
    await expect.poll(() => this.selectionIds()).toEqual([pointId]);
  }

  /** Returns a safe drag for a visible on-curve point; throws when none exists. */
  async selectVisiblePoint(): Promise<PointDrag> {
    const point = await this.#hooks.canvas.visiblePointDrag();

    await this.page.mouse.click(point.startPagePosition.x, point.startPagePosition.y);
    await expect.poll(() => this.selectionIds()).toContain(point.id);

    return point;
  }

  /**
   * Drags one prepared point and waits for confirmed geometry.
   * @param point - Drag returned by {@link selectVisiblePoint}.
   */
  async dragPoint(point: PointDrag): Promise<void> {
    await this.page.mouse.move(point.startPagePosition.x, point.startPagePosition.y);
    await this.page.mouse.down();
    await this.page.mouse.move(point.endPagePosition.x, point.endPagePosition.y, { steps: 5 });
    await this.page.mouse.up();
    await this.#waitForEdits();
  }

  /** Returns a hovered visible point identity; throws when none exists. */
  async hoverVisibleUnselectedPoint(): Promise<PointId> {
    const target = await this.#hooks.canvas.unselectedPoint();

    await this.page.mouse.move(target.x, target.y);
    await expect.poll(() => this.hoverId()).toBe(target.id);
    return target.id;
  }

  /**
   * Converts a position normalized to the interactive canvas into page coordinates.
   *
   * @remarks
   * Keeps gesture geometry independent of sidebar widths and toolbar height.
   * @param fraction - Fractions from zero to one along the canvas width and height.
   * @returns Rounded page coordinates for pointer input.
   * @throws {Error} when a fraction lies outside the canvas.
   */
  async canvasPagePoint(fraction: Point2D): Promise<Point2D> {
    if (fraction.x < 0 || fraction.x > 1 || fraction.y < 0 || fraction.y > 1) {
      throw new Error("Canvas positions must be normalized between zero and one");
    }

    const bounds = await this.canvasBounds();
    return {
      x: Math.round(bounds.x + bounds.width * fraction.x),
      y: Math.round(bounds.y + bounds.height * fraction.y),
    };
  }

  async outline(): Promise<Outline> {
    return (await this.#openLayer()).contours;
  }

  async point(id: PointId, { source }: PointReadOptions = {}): Promise<AuthoredPoint | null> {
    if (source === undefined) return this.#pointIn(await this.outline(), id);

    const { glyph } = await this.editorView();
    if (!glyph) throw new Error("Expected an open glyph");
    const shown = { glyph: { glyphId: glyph.glyphId }, source: { sourceId: glyph.sourceId } };
    const other = { glyph: { glyphId: glyph.glyphId }, source };
    const match = await this.#reads.font.matchLayers(shown, other);
    if (!match.complete) return null;

    const counterpart = match.points.find(({ referenceId }) => referenceId === id);
    if (!counterpart) return null;
    const layer = await this.#reads.font.getLayer(other);
    return this.#pointIn(layer.contours, counterpart.targetId);
  }

  #pointIn(outline: Outline, id: PointId): AuthoredPoint | null {
    return outline.flatMap((contour) => contour.points).find((point) => point.id === id) ?? null;
  }

  /** The open glyph's anchor named `name`, in the shown source or `source`; null when it has none. */
  async anchorNamed(
    name: string,
    { source }: AnchorReadOptions = {},
  ): Promise<AuthoredAnchor | null> {
    const { glyph } = await this.editorView();
    if (!glyph) throw new Error("Expected an open glyph");
    const { anchors } =
      source === undefined ? await this.#openLayer() : await this.layerOf(glyph.name, source);
    return anchors.find((anchor) => anchor.name === name) ?? null;
  }

  async anchors(): Promise<readonly AuthoredAnchor[]> {
    return (await this.#openLayer()).anchors;
  }

  async components(): Promise<readonly AuthoredComponent[]> {
    return (await this.#openLayer()).components;
  }

  async advanceWidth(): Promise<number> {
    return (await this.#openLayer()).advanceWidth;
  }

  async kerning(first: string, second: string): Promise<readonly KerningMasterValue[]> {
    const pair = { first: { name: first }, second: { name: second } };
    const resolved = await this.#reads.kerning.resolve([pair], {});
    return resolved.items[0]!.masters;
  }

  async kerningAt(source: string, first: string, second: string): Promise<KerningMasterValue> {
    return this.#reads.kerning.at({
      first: { name: first },
      second: { name: second },
      source: { name: source },
    });
  }

  async kerningGroups(position: KerningPosition): Promise<readonly KerningGroupSummary[]> {
    return this.#reads.kerning.groups(position);
  }

  async kerningGroup(position: KerningPosition, name: string): Promise<KerningGroupSummary | null> {
    return this.#reads.kerning.group(position, name);
  }

  async kerningGroupOf(
    position: KerningPosition,
    glyph: string,
  ): Promise<KerningGroupSummary | null> {
    return this.#reads.kerning.groupOf(position, { name: glyph as GlyphName });
  }

  async selectionIds(): Promise<readonly string[]> {
    return (await this.editorView()).selectionIds;
  }

  async glyphNames(): Promise<readonly string[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.#reads.font.listGlyphs({ limit: 100, cursor });
      names.push(...page.items.map((glyph) => glyph.name));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return names;
  }

  async glyphNamed(name: string): Promise<GlyphListing | null> {
    return this.#reads.font.glyphNamed(name as GlyphName);
  }

  async source(selector: SourceSelection): Promise<Source | null> {
    switch (selector) {
      case "default":
        return this.#reads.font.defaultSource();
      case "active":
        return this.#reads.editor.activeSource();
    }
    return "id" in selector
      ? this.#reads.font.source({ sourceId: selector.id })
      : this.#reads.font.source({ name: selector.name });
  }

  async instance(selector: InstanceSelection): Promise<NamedInstance | null> {
    return "id" in selector
      ? this.#reads.font.instance({ instanceId: selector.id })
      : this.#reads.font.instance({ name: selector.name });
  }

  async axis(selector: AxisSelection): Promise<Axis | null> {
    return "id" in selector
      ? this.#reads.font.axis({ axisId: selector.id })
      : this.#reads.font.axis({ tag: selector.tag });
  }

  /**
   * Clicks the row of the source named `name` in the Variations panel, opening the panel first.
   * With `toggle` it Cmd-clicks (Ctrl-clicks off macOS) the row, adding the source to the ones
   * being edited, and waits until their layers are matched to the active one.
   */
  async clickSource(name: string, mode?: SourceSelectionMode): Promise<void> {
    const source = await this.source({ name });
    if (!source) throw new Error(`The font has no source named ${name}`);

    const row = sourceRow(await openVariationControls(this.page), name);
    if (mode === "toggle") {
      await row.click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
      await this.#hooks.session.editingLayersMatched();
      return;
    }
    await row.click();
    await expect.poll(async () => (await this.source("active"))?.id).toBe(source.id);
  }

  async layerOf(glyph: string, source?: string): Promise<SourceLayer> {
    return this.#reads.font.getLayer({
      glyph: { name: glyph as GlyphName },
      source: source === undefined ? undefined : { name: source },
    });
  }

  async fontOverview(): Promise<FontSummary> {
    return this.#reads.font.getFont();
  }

  async editorView(): Promise<EditorViewState> {
    return this.#reads.editor.inspect(new URL(this.page.url()).hash.slice(1));
  }

  async location(): Promise<LocationSummary> {
    const { externalLocation } = await this.editorView();
    return this.#reads.font.resolveLocation(externalLocation);
  }

  async documentState(): Promise<DocumentSaveState | null> {
    return this.#reads.editor.documentState();
  }

  async canvasText(): Promise<CanvasText | null> {
    return this.#reads.editor.textRun();
  }

  async spacingTool(): Promise<SpacingToolState | null> {
    return this.#reads.editor.spacingTool();
  }

  async drawnHandles(): Promise<readonly CanvasHandle[]> {
    return this.#reads.editor.drawnHandles();
  }

  /** The open glyph's outline as the canvas draws it now, a gesture's uncommitted preview included. */
  async drawnOutline(): Promise<readonly AuthoredContour[]> {
    return this.#reads.editor.drawnOutline();
  }

  /** The snap guides the active tool draws for the gesture in flight, in glyph units. */
  async drawnSnapGuides(): Promise<readonly PositionGuide[]> {
    return this.#reads.editor.drawnSnapGuides();
  }

  /**
   * Where an edit of the active layer's point `pointId` moves a point in each source being
   * edited: the active source first, a gesture's preview included.
   */
  async matchedPoints(pointId: PointId): Promise<readonly MatchedPoint[]> {
    return this.#reads.editor.matchedPoints(pointId);
  }

  /** Whether the editor tracks a pointer over the canvas, or one a gesture has captured. */
  async hasPointer(): Promise<boolean> {
    return this.#reads.editor.hasPointer();
  }

  /** The handles the Select tool previews on the Cmd-hovered line segment, in glyph units; null while none. */
  async drawnUpgradePreview(): Promise<readonly LocalPoint[] | null> {
    const preview = await this.#reads.editor.drawnUpgradePreview();
    return preview?.map(({ x, y }) => localPoint(x, y)) ?? null;
  }

  /** The drawn contour `contourId`, a gesture's preview included; null when the open glyph draws none. */
  async drawnContour(contourId: string): Promise<AuthoredContour | null> {
    return (await this.drawnOutline()).find((contour) => contour.id === contourId) ?? null;
  }

  /** Where the Pen's drag places the outgoing handle now, in glyph units; null outside a Pen drag. */
  async drawnPenHandle(): Promise<LocalPoint | null> {
    const handle = await this.#reads.editor.drawnPenHandle();
    return handle ? localPoint(handle.x, handle.y) : null;
  }

  /** The selected objects with their kinds, in selection order. */
  async selectedObjects(): Promise<readonly SelectedObject[]> {
    return this.#reads.editor.selectedObjects();
  }

  async drawnOutlineTargets(): Promise<readonly OutlineTarget[]> {
    return this.#reads.editor.drawnOutlineTargets();
  }

  /** The open glyph's authored layer at its node's source, as `layers.get` returns it. */
  async #openLayer(): Promise<AuthoredLayer> {
    const { glyph } = await this.editorView();
    if (!glyph) throw new Error("Expected an open glyph");
    return this.#reads.font.getLayer({
      glyph: { glyphId: glyph.glyphId },
      source: { sourceId: glyph.sourceId },
    });
  }

  /** The app's readers in this page's window; each read runs once its pending edits settle. */
  get #reads(): Remote<AppReaders> {
    return readsOf(this.page);
  }

  /** The renderer's E2E hooks in this page's window; an action answers once its edit is confirmed. */
  get #hooks(): Remote<E2EHooks> {
    return hooksOf(this.page);
  }

  async #waitForEdits(): Promise<void> {
    await this.#hooks.session.settle();
  }
}
