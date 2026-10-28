import { expect, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import type { Point2D, Rect2D } from "@shift/geo";
import type {
  AuthoredAnchor,
  AuthoredComponent,
  AuthoredLayer,
  AuthoredPoint,
  KerningGroupSummary,
  KerningMasterValue,
} from "@shift/runtime";
import type {
  AxisId,
  GlyphId,
  GlyphName,
  KerningPosition,
  PointId,
  Axis,
  NamedInstance,
  Source,
} from "@shift/types";
import type {
  AgentReaderName,
  AgentReadArgs,
  AgentReadMethod,
  AgentReadResult,
} from "@/agent/AgentReaders";
import type {
  CanvasHandle,
  CanvasText,
  AxisSelection,
  DocumentSaveState,
  EditorActions,
  EditorReads,
  InstanceSelection,
  SourceSelection,
  EditorViewState,
  FontSummary,
  GlyphListing,
  LocationSummary,
  Outline,
  OutlineTarget,
  SourceLayer,
  SpacingToolState,
} from "@/testing/reads";
import type { DrawOptions, GlyphFixture, PointNames } from "@/testing/fixtures";
import { callHook, readAgent, registerApp, setupActions, type E2ESetup } from "./appHooks";
import { openVariationControls, waitForEditorReady } from "./appLocators";
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
  await expect.poll(() => callHook(page, "editor", "glyphOpen", glyphId)).toBe(true);
}

/**
 * Drives the real desktop editor through Playwright and reads its observable domain state.
 *
 * @remarks
 * User actions that can persist geometry wait for the workspace edit pipeline before returning.
 * The {@link EditorReads} reads call the window's agent readers, the ones agents read through
 * MCP, over the app's E2E read hook (`globalThis.shiftAgentReads`), with the same reader calls
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

  /**
   * The window's setup actions (`testing/E2EActions.ts`): edits a spec isn't about, made through
   * the editor's public commands, each waiting until the workspace confirms it.
   */
  get setup(): E2ESetup {
    return setupActions(this.page);
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
      .poll(() => callHook(this.page, "editor", "glyphForUnicode", unicode), { timeout: 20_000 })
      .not.toBeNull();
    const glyphId = await callHook(this.page, "editor", "glyphForUnicode", unicode);
    if (!glyphId) throw new Error(`No glyph found for U+${hexCodepoint}`);

    await this.setup.openGlyph(glyphId);
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
    await this.setup.openGlyph(glyphId);
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
    // The setup facade drops `draw`'s generic; the ids are keyed by the fixture's own names.
    return (await this.setup.draw(fixture, options)) as Record<PointNames<F>, PointId>;
  }

  /**
   * Adds the glyph named `name`, encoded at `unicode`, and loads it, as vitest's `addGlyph`
   * does; throws when the font's glyph metadata would name or encode it otherwise.
   */
  async addGlyph(name: string, unicode: number | null): Promise<void> {
    await this.setup.createGlyph(name, unicode);
  }

  /** Adds a continuous axis, as the Create axis menu does, and waits for it. */
  async addAxis(axis: AxisFixture): Promise<void> {
    await this.setup.createAxis({
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

  /**
   * Adds a source named `name` at `location`, keyed by axis tag, as the Create source menu does,
   * and waits for it: the editor moves there and the new source becomes active.
   */
  async addSource(name: string, location: AxisLocation): Promise<void> {
    const values: Record<AxisId, number> = {};
    for (const [tag, value] of Object.entries(location)) {
      const axis = await this.axis({ tag });
      if (!axis) throw new Error(`The font has no axis tagged ${tag}`);
      values[axis.id] = value;
    }
    await this.setup.createSourceHere(name, values);
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
  async projectSceneToCanvas(position: Point2D): Promise<Point2D> {
    return callHook(this.page, "editor", "sceneToCanvas", position);
  }

  /**
   * Projects a scene position into Playwright page coordinates.
   * @param position - Editor scene position.
   */
  async projectSceneToPage(position: Point2D): Promise<Point2D> {
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
  async projectGlyphToPage(position: Point2D): Promise<Point2D> {
    const [canvasPosition, bounds] = await Promise.all([
      callHook(this.page, "editor", "glyphToCanvas", position),
      this.canvasBounds(),
    ]);
    return { x: bounds.x + canvasPosition.x, y: bounds.y + canvasPosition.y };
  }

  /**
   * Projects a canvas-local position into scene coordinates.
   * @param position - Point relative to the canvas origin.
   */
  async projectCanvasToScene(position: Point2D): Promise<Point2D> {
    return callHook(this.page, "editor", "canvasToScene", position);
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
    const modifiers = input.modifiers ?? [];

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
    await this.setup.flushPointerMoves();
  }

  /** Waits until the current gesture and its workspace edits are complete. */
  async waitForIdle(): Promise<void> {
    await expect(this.shell).toHaveAttribute("data-gesture", "idle", { timeout: 30_000 });
    await this.#waitForEdits();
  }

  /** Returns the glyph being edited, or null when none is (or its authored layer is not published). */
  async activeGlyph(): Promise<ActiveGlyph | null> {
    return callHook(this.page, "editor", "editedGlyph");
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
    return callHook(this.page, "editor", "zoom");
  }

  /** Returns how far the canvas is panned, in screen pixels. */
  async canvasOffset(): Promise<Point2D> {
    return callHook(this.page, "editor", "pan");
  }

  /** Returns the ids of the scene nodes being edited, in the order they were entered. */
  async editedNodeIds(): Promise<readonly string[]> {
    return callHook(this.page, "editor", "editedNodeIds");
  }

  /** Returns the hovered editor object identity, or null when nothing is hovered. */
  async hoverId(): Promise<string | null> {
    return callHook(this.page, "editor", "hoverId");
  }

  /** Returns the active tool's published state discriminator. */
  async toolState(): Promise<string | null> {
    return callHook(this.page, "editor", "toolState");
  }

  /** Returns fresh live selection bounds in glyph units; throws without a bounded selection. */
  async selectionBounds(): Promise<Rect2D> {
    const b = await callHook(this.page, "editor", "selectionBounds");
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

    return callHook(this.page, "editor", "pointProjections", pointIds);
  }

  /**
   * Returns a confirmed glyph-local position; throws when absent.
   * @param pointId - Point in the active authored layer.
   */
  async pointPosition(pointId: PointId): Promise<Point2D> {
    return (await this.pointPositions([pointId]))[pointId];
  }

  /**
   * Returns the current preview position without waiting for persistence.
   * @param pointId - Point in the active authored layer.
   */
  async livePointPosition(pointId: PointId): Promise<Point2D> {
    return callHook(this.page, "editor", "livePointPosition", pointId);
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
    const point = await callHook(this.page, "editor", "visiblePointDrag");

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
    const target = await callHook(this.page, "editor", "unselectedPoint");

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

  async point(id: PointId): Promise<AuthoredPoint | null> {
    const outline = await this.outline();
    return outline.flatMap((contour) => contour.points).find((point) => point.id === id) ?? null;
  }

  async anchors(): Promise<readonly AuthoredAnchor[]> {
    return (await this.#openLayer()).anchors;
  }

  async components(): Promise<readonly AuthoredComponent[]> {
    return (await this.#openLayer()).components;
  }

  async pointPositions(ids: readonly PointId[]): Promise<Record<PointId, Point2D>> {
    const outline = await this.outline();
    const points = new Map(
      outline.flatMap((contour) => contour.points).map((point) => [point.id, point]),
    );
    return Object.fromEntries(
      ids.map((id) => {
        const point = points.get(id);
        if (!point) throw new Error(`The open glyph has no point ${id}`);
        return [id, { x: point.x, y: point.y }];
      }),
    ) as Record<PointId, Point2D>;
  }

  async advanceWidth(): Promise<number> {
    return (await this.#openLayer()).advanceWidth;
  }

  async kerning(first: string, second: string): Promise<readonly KerningMasterValue[]> {
    const pair = { first: { name: first }, second: { name: second } };
    const resolved = await this.#read("kerning", "resolve", [pair], {});
    return resolved.items[0]!.masters;
  }

  async kerningAt(source: string, first: string, second: string): Promise<KerningMasterValue> {
    return this.#read("kerning", "at", {
      first: { name: first },
      second: { name: second },
      source: { name: source },
    });
  }

  async kerningGroups(position: KerningPosition): Promise<readonly KerningGroupSummary[]> {
    return this.#read("kerning", "groups", position);
  }

  async kerningGroup(position: KerningPosition, name: string): Promise<KerningGroupSummary | null> {
    return this.#read("kerning", "group", position, name);
  }

  async kerningGroupOf(
    position: KerningPosition,
    glyph: string,
  ): Promise<KerningGroupSummary | null> {
    return this.#read("kerning", "groupOf", position, { name: glyph as GlyphName });
  }

  async selectionIds(): Promise<readonly string[]> {
    return (await this.editorView()).selectionIds;
  }

  async glyphNames(): Promise<readonly string[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.#read("font", "listGlyphs", { limit: 100, cursor });
      names.push(...page.items.map((glyph) => glyph.name));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return names;
  }

  async glyphNamed(name: string): Promise<GlyphListing | null> {
    return this.#read("font", "glyphNamed", name as GlyphName);
  }

  async source(selector: SourceSelection): Promise<Source | null> {
    switch (selector) {
      case "default":
        return this.#read("font", "defaultSource");
      case "active":
        return this.#read("editor", "activeSource");
    }
    return "id" in selector
      ? this.#read("font", "source", { sourceId: selector.id })
      : this.#read("font", "source", { name: selector.name });
  }

  async instance(selector: InstanceSelection): Promise<NamedInstance | null> {
    return "id" in selector
      ? this.#read("font", "instance", { instanceId: selector.id })
      : this.#read("font", "instance", { name: selector.name });
  }

  async axis(selector: AxisSelection): Promise<Axis | null> {
    return "id" in selector
      ? this.#read("font", "axis", { axisId: selector.id })
      : this.#read("font", "axis", { tag: selector.tag });
  }

  /** Clicks the row of the source named `name` in the Variations panel, opening the panel first. */
  async clickSource(name: string): Promise<void> {
    const source = await this.source({ name });
    if (!source) throw new Error(`The font has no source named ${name}`);

    const controls = await openVariationControls(this.page);
    await controls.getByTestId(`source-${source.id}`).click();
    await expect.poll(async () => (await this.source("active"))?.id).toBe(source.id);
  }

  async layerOf(glyph: string, source?: string): Promise<SourceLayer> {
    return this.#read("font", "getLayer", {
      glyph: { name: glyph as GlyphName },
      ...(source === undefined ? {} : { source: { name: source } }),
    });
  }

  async fontOverview(): Promise<FontSummary> {
    return this.#read("font", "getFont");
  }

  async editorView(): Promise<EditorViewState> {
    return this.#read("editor", "inspect", new URL(this.page.url()).hash.slice(1));
  }

  async location(): Promise<LocationSummary> {
    const { externalLocation } = await this.editorView();
    return this.#read("font", "resolveLocation", externalLocation);
  }

  async documentState(): Promise<DocumentSaveState | null> {
    return this.#read("editor", "documentState");
  }

  async canvasText(): Promise<CanvasText | null> {
    return this.#read("editor", "textRun");
  }

  async spacingTool(): Promise<SpacingToolState | null> {
    return this.#read("editor", "spacingTool");
  }

  async drawnHandles(): Promise<readonly CanvasHandle[]> {
    return this.#read("editor", "drawnHandles");
  }

  async drawnOutlineTargets(): Promise<readonly OutlineTarget[]> {
    return this.#read("editor", "drawnOutlineTargets");
  }

  /** The open glyph's authored layer at its node's source, as `layers.get` returns it. */
  async #openLayer(): Promise<AuthoredLayer> {
    const { glyph } = await this.editorView();
    if (!glyph) throw new Error("Expected an open glyph");
    return this.#read("font", "getLayer", {
      glyph: { glyphId: glyph.glyphId },
      source: { sourceId: glyph.sourceId },
    });
  }

  /**
   * Calls `reader`'s `method` in this page's window once its pending edits settle.
   *
   * @throws {Error} when the driver has no app, or the read fails in the renderer.
   */
  async #read<R extends AgentReaderName, M extends AgentReadMethod<R>>(
    reader: R,
    method: M,
    ...args: AgentReadArgs<R, M>
  ): Promise<AgentReadResult<R, M>> {
    return readAgent(this.page, reader, method, args);
  }

  async #waitForEdits(): Promise<void> {
    await this.setup.settle();
  }
}
