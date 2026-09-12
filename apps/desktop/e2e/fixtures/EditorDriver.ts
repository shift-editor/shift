import type { Locator, Page } from "@playwright/test";
import type { Bounds, Point2D } from "@shift/geo";
import type { Point } from "@shift/glyph-state";
import type { PointId, Unicode } from "@shift/types";
import { waitForEditorReady } from "./appLocators";
import type { Outline, PointDrag, PointTarget } from "./types";

const TOOL_LABELS = {
  select: "Select Tool (V)",
  pen: "Pen Tool (P)",
  hand: "Hand Tool (H)",
  rectangle: "Rectangle Tool (R)",
  ellipse: "Ellipse Tool (O)",
} as const;

/**
 * Drives the real desktop editor through Playwright and reads its observable domain state.
 *
 * @remarks
 * User actions that can persist geometry wait for the workspace edit pipeline before returning.
 * Live gesture observations remain available through methods such as {@link selectionBounds}.
 */
export class EditorDriver {
  /**
   * Creates an editor driver for one workspace page.
   *
   * @param page - Playwright page that owns the editor being exercised.
   */
  constructor(readonly page: Page) {}

  /** Returns the interactive editor canvas locator. */
  get canvas(): Locator {
    return this.page.locator("#interactive-canvas");
  }

  /** Returns the editor shell locator that publishes gesture state. */
  get shell(): Locator {
    return this.page.getByTestId("editor-shell");
  }

  /**
   * Opens the glyph mapped to a hexadecimal Unicode codepoint.
   *
   * @param hexCodepoint - Hexadecimal scalar value, such as `41` for `A`.
   * @throws {Error} when the loaded font has no matching glyph record.
   */
  async openGlyphByUnicode(hexCodepoint: string): Promise<void> {
    const unicode = Number.parseInt(hexCodepoint, 16) as Unicode;
    await this.page.waitForFunction(
      (codepoint) => {
        const font = window.shift?.font;
        if (!font) return false;

        const handle = font.glyphHandleForUnicode(codepoint as Unicode);
        return font.recordForName(handle.name) !== null;
      },
      unicode,
      { timeout: 20_000 },
    );

    const glyphId = await this.page.evaluate(async (codepoint) => {
      const workspace = window.shift;
      if (!workspace) throw new Error("Expected workspace");

      const handle = workspace.font.glyphHandleForUnicode(codepoint as Unicode);
      const record = workspace.font.recordForName(handle.name);
      if (!record) throw new Error(`No glyph found for U+${codepoint.toString(16)}`);

      await workspace.font.loadGlyph(record.id);
      window.location.hash = `#/editor/${encodeURIComponent(record.id)}`;
      return record.id;
    }, unicode);

    await waitForEditorReady(this.page, glyphId);
    await this.page.waitForTimeout(1000);
  }

  /**
   * Opens a glyph by its font-directory name.
   *
   * @param name - Exact glyph name in the loaded workspace.
   * @throws {Error} when the loaded font has no matching glyph record.
   */
  async openGlyphByName(name: string): Promise<void> {
    const glyphId = await this.page.evaluate((glyphName) => {
      const record = window.shift?.font.glyphRecords().find((glyph) => glyph.name === glyphName);
      if (!record) throw new Error(`Expected ${glyphName} glyph`);
      return record.id;
    }, name);

    await this.openGlyph(glyphId);
  }

  /**
   * Opens an already known glyph identity and waits for scene publication.
   *
   * @param glyphId - Glyph identity present in the loaded workspace.
   * @throws {Error} when the workspace is unavailable or glyph acquisition fails.
   */
  async openGlyph(glyphId: string): Promise<void> {
    await this.page.evaluate(async (id) => {
      const font = window.shift?.font;
      if (!font) throw new Error("Expected font workspace");

      await font.loadGlyph(id);
      window.location.hash = `#/editor/${encodeURIComponent(id)}`;
    }, glyphId);
    await waitForEditorReady(this.page, glyphId);
  }

  /**
   * Selects an editor toolbar tool by its stable tool identity.
   *
   * @param tool - Tool whose primary toolbar action should be activated.
   */
  async selectTool(tool: keyof typeof TOOL_LABELS): Promise<void> {
    await this.page.getByRole("button", { name: TOOL_LABELS[tool], exact: true }).click();
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
   * Sends a keyboard chord and waits for the workspace edit pipeline.
   *
   * @param key - Playwright keyboard chord delivered to the focused workspace.
   */
  async press(key: string): Promise<void> {
    await this.page.keyboard.press(key);
    await this.#waitForEdits();
  }

  /** Flushes the latest coalesced pointer move into the active tool gesture. */
  async flushPointerMoves(): Promise<void> {
    await this.page.evaluate(() => window.shift?.editor.toolManager.flushPointerMoves());
  }

  /** Waits until the current gesture and its workspace edits are complete. */
  async waitForIdle(): Promise<void> {
    await this.shell.waitFor({ state: "visible" });
    await this.page.waitForFunction(
      () =>
        document.querySelector("[data-testid='editor-shell']")?.getAttribute("data-gesture") ===
        "idle",
    );
    await this.#waitForEdits();
  }

  /** Returns a fresh snapshot of the current selection identities. */
  async selectionIds(): Promise<readonly string[]> {
    return this.page.evaluate(() => window.shift?.editor.selection.ids ?? []);
  }

  /**
   * Returns the current selection bounds, including live gesture previews.
   *
   * @returns a fresh bounds snapshot.
   * @throws {Error} when the editor has no bounded selection.
   */
  async selectionBounds(): Promise<Bounds> {
    const bounds = await this.page.evaluate(() => window.shift?.editor.selectionBounds());
    if (!bounds) throw new Error("Expected selection bounds");

    return bounds;
  }

  /**
   * Returns confirmed geometry for every contour in the active authored layer.
   *
   * @returns a fresh serializable outline snapshot.
   * @throws {Error} when no authored glyph layer is active.
   */
  async outline(): Promise<Outline> {
    await this.#waitForEdits();

    return this.page.evaluate(() => {
      const editor = window.shift?.editor;
      const node = editor?.scene.nodesOfKind("glyph")[0];
      const layer = node ? editor?.glyphForId(node.glyphId)?.layerForSource(node.sourceId) : null;
      if (!layer) throw new Error("Expected authored layer");

      const snapshotPoint = (point: Point) => ({
        id: point.id,
        x: point.x,
        y: point.y,
        pointType: point.pointType,
        smooth: point.smooth,
      });

      return layer.contours.map((contour) => ({
        id: contour.id,
        closed: contour.closed,
        points: contour.points.map(snapshotPoint),
        onCurvePoints: contour.points.filter((point) => point.isOnCurve).map(snapshotPoint),
        segments: contour.segments().map((segment) => segment.type),
      }));
    });
  }

  /**
   * Returns glyph-local and canvas positions for editable points.
   *
   * @param pointIds - Points in the active authored layer, in desired result order.
   * @returns fresh point targets suitable for canvas interactions.
   * @throws {Error} when any requested point is absent from the active layer.
   */
  async pointTargets(pointIds: readonly PointId[]): Promise<readonly PointTarget[]> {
    await this.#waitForEdits();

    return this.page.evaluate((ids) => {
      const editor = window.shift?.editor;
      const node = editor?.scene.nodesOfKind("glyph")[0];
      const layer = node ? editor?.glyphForId(node.glyphId)?.layerForSource(node.sourceId) : null;
      if (!editor || !node || !layer) throw new Error("Expected editable glyph");

      return ids.map((id) => {
        const point = layer.point(id);
        if (!point) throw new Error(`Expected editable point ${id}`);

        return {
          id,
          glyphPosition: { x: point.x, y: point.y },
          canvasPosition: editor.projectSceneToScreen({
            x: point.x + node.position.x,
            y: point.y + node.position.y,
          }),
        };
      });
    }, pointIds);
  }

  /**
   * Returns confirmed glyph-local coordinates for one editable point.
   *
   * @param pointId - Point in the active authored layer.
   * @returns a fresh glyph-local position.
   * @throws {Error} when the point is absent from the active layer.
   */
  async pointPosition(pointId: PointId): Promise<Point2D> {
    await this.#waitForEdits();

    return this.page.evaluate((id) => {
      const editor = window.shift?.editor;
      const node = editor?.scene.nodesOfKind("glyph")[0];
      const point = node
        ? editor
            ?.glyphForId(node.glyphId)
            ?.layerForSource(node.sourceId)
            ?.allPoints.find((candidate) => candidate.id === id)
        : null;
      if (!point) throw new Error("Expected editable point");

      return { x: point.x, y: point.y };
    }, pointId);
  }

  /**
   * Selects one point through its rendered canvas position.
   *
   * @param pointId - Point in the active authored layer.
   * @throws {Error} when the point is absent from the active layer.
   */
  async clickPoint(pointId: PointId): Promise<void> {
    const [target] = await this.pointTargets([pointId]);

    await this.canvas.click({ position: target.canvasPosition });
    await this.page.waitForFunction(
      (id) =>
        window.shift?.editor.selection.ids.length === 1 && window.shift.editor.selection.has(id),
      pointId,
    );
  }

  /**
   * Selects a visible on-curve point and returns a safe page-space drag.
   *
   * @returns drag coordinates and the expected glyph-local destination.
   * @throws {Error} when the active layer has no safely visible on-curve point.
   */
  async selectVisiblePoint(): Promise<PointDrag> {
    const point = await this.page.evaluate(() => {
      const workspace = window.shift;
      const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
      const node = workspace?.editor.scene.nodesOfKind("glyph")[0];
      const glyph = node ? workspace?.editor.glyphForId(node.glyphId) : null;
      const layer = node ? glyph?.layerForSource(node.sourceId) : null;
      if (!workspace || !canvas || !node || !layer) throw new Error("Expected editable glyph");

      const bounds = canvas.getBoundingClientRect();
      const candidates = layer.allPoints
        .filter((candidate) => candidate.isOnCurve)
        .map((candidate) => ({
          point: candidate,
          screen: workspace.editor.projectSceneToScreen({
            x: candidate.x + node.position.x,
            y: candidate.y + node.position.y,
          }),
        }))
        .filter(
          ({ screen }) =>
            screen.x >= 50 &&
            screen.y >= 50 &&
            screen.x <= bounds.width - 100 &&
            screen.y <= bounds.height - 100,
        )
        .sort(
          (a, b) =>
            Math.hypot(a.screen.x - bounds.width / 2, a.screen.y - bounds.height / 2) -
            Math.hypot(b.screen.x - bounds.width / 2, b.screen.y - bounds.height / 2),
        );
      const candidate = candidates[0];
      if (!candidate) throw new Error("Expected visible on-curve point");

      const endScreen = { x: candidate.screen.x + 40, y: candidate.screen.y + 30 };
      const endScene = workspace.editor.projectScreenToScene(endScreen);
      return {
        id: candidate.point.id,
        startPagePosition: {
          x: bounds.left + candidate.screen.x,
          y: bounds.top + candidate.screen.y,
        },
        endPagePosition: { x: bounds.left + endScreen.x, y: bounds.top + endScreen.y },
        expectedGlyphPosition: {
          x: endScene.x - node.position.x,
          y: endScene.y - node.position.y,
        },
      };
    });

    await this.page.mouse.click(point.startPagePosition.x, point.startPagePosition.y);
    await this.page.waitForFunction(
      (pointId) => window.shift?.editor.selection.has(pointId),
      point.id,
    );

    return point;
  }

  /**
   * Drags one prepared point target and waits for confirmed workspace geometry.
   *
   * @param point - Page-space drag returned by {@link selectVisiblePoint}.
   */
  async dragPoint(point: PointDrag): Promise<void> {
    await this.page.mouse.move(point.startPagePosition.x, point.startPagePosition.y);
    await this.page.mouse.down();
    await this.page.mouse.move(point.endPagePosition.x, point.endPagePosition.y, { steps: 5 });
    await this.page.mouse.up();
    await this.#waitForEdits();
  }

  /**
   * Hovers a visible unselected point and waits for editor hover publication.
   *
   * @returns identity of the hovered point.
   * @throws {Error} when the active layer has no unselected on-curve point.
   */
  async hoverVisibleUnselectedPoint(): Promise<PointId> {
    const target = await this.page.evaluate(() => {
      const workspace = window.shift;
      const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
      const node = workspace?.editor.scene.nodesOfKind("glyph")[0];
      const glyph = node ? workspace?.editor.glyphForId(node.glyphId) : null;
      const layer = node ? glyph?.layerForSource(node.sourceId) : null;
      if (!workspace || !canvas || !node || !layer) throw new Error("Expected editable glyph");

      const point = layer.allPoints.find(
        (candidate) => candidate.isOnCurve && !workspace.editor.selection.has(candidate.id),
      );
      if (!point) throw new Error("Expected unselected point");

      const screen = workspace.editor.projectSceneToScreen({
        x: point.x + node.position.x,
        y: point.y + node.position.y,
      });
      const bounds = canvas.getBoundingClientRect();
      return { id: point.id, x: bounds.left + screen.x, y: bounds.top + screen.y };
    });

    await this.page.mouse.move(target.x, target.y);
    await this.page.waitForFunction(
      (pointId) => window.shift?.editor.hover.id === pointId,
      target.id,
    );
    return target.id;
  }

  async #waitForEdits(): Promise<void> {
    await this.page.evaluate(async () => window.shift?.font.editCoordinator.settled());
  }
}
