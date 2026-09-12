import type { Locator, Page } from "@playwright/test";
import type { Point2D, Rect2D } from "@shift/geo";
import type { Point } from "@shift/glyph-state";
import type { PointId, Unicode } from "@shift/types";
import { waitForEditorReady } from "./appLocators";
import type {
  ActiveGlyph,
  CanvasBounds,
  CanvasDrag,
  Outline,
  PointDrag,
  PointTarget,
} from "./types";

const TOOL_LABELS = {
  select: "Select Tool (V)",
  pen: "Pen Tool (P)",
  hand: "Hand Tool (H)",
  rectangle: "Rectangle Tool (R)",
  ellipse: "Ellipse Tool (O)",
} as const;

async function waitForActiveGlyph(page: Page, glyphId: string): Promise<void> {
  await page.waitForFunction((expectedGlyphId) => {
    const editor = window.shift?.editor;
    const node = editor?.scene.nodesOfKind("glyph")[0];
    if (!editor || !node || node.glyphId !== expectedGlyphId) return false;

    return Boolean(editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId));
  }, glyphId);
}

async function readLivePointPosition(page: Page, pointId: PointId): Promise<Point2D> {
  return page.evaluate((id) => {
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
 * Drives the real desktop editor through Playwright and reads its observable domain state.
 *
 * @remarks
 * User actions that can persist geometry wait for the workspace edit pipeline before returning.
 * Live gesture observations remain available through methods such as {@link selectionBounds}.
 */
export class EditorDriver {
  /**
   * Creates a driver for the editor owned by `page`.
   * @param page - Workspace page under test.
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
   * Opens the glyph mapped to `hexCodepoint`; throws when none exists.
   * @param hexCodepoint - Hexadecimal scalar value, such as `41` for `A`.
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
    await waitForActiveGlyph(this.page, glyphId);
    await this.page.waitForTimeout(1000);
  }

  /**
   * Opens the exact named glyph; throws when none exists.
   * @param name - Glyph name in the loaded workspace.
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
   * Opens a known glyph and waits for scene publication.
   * @param glyphId - Glyph identity in the loaded workspace.
   */
  async openGlyph(glyphId: string): Promise<void> {
    await this.page.evaluate(async (id) => {
      const font = window.shift?.font;
      if (!font) throw new Error("Expected font workspace");

      await font.loadGlyph(id);
      window.location.hash = `#/editor/${encodeURIComponent(id)}`;
    }, glyphId);
    await waitForEditorReady(this.page, glyphId);
    await waitForActiveGlyph(this.page, glyphId);
  }

  /**
   * Selects a toolbar tool by stable identity.
   * @param tool - Primary tool action to activate.
   */
  async selectTool(tool: keyof typeof TOOL_LABELS): Promise<void> {
    await this.page.getByRole("button", { name: TOOL_LABELS[tool], exact: true }).click();
  }

  /**
   * Returns fresh page-space canvas bounds; throws before canvas rendering.
   */
  async canvasBounds(): Promise<CanvasBounds> {
    const bounds = await this.canvas.boundingBox();
    if (!bounds) throw new Error("Expected interactive canvas bounds");

    return bounds;
  }

  /**
   * Projects a scene position into canvas-local coordinates.
   * @param position - Editor scene position.
   */
  async projectSceneToCanvas(position: Point2D): Promise<Point2D> {
    return this.page.evaluate((scenePosition) => {
      const editor = window.shiftSession?.editor;
      if (!editor) throw new Error("Expected editor");

      return editor.projectSceneToScreen(scenePosition);
    }, position);
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
   * Projects a canvas-local position into scene coordinates.
   * @param position - Point relative to the canvas origin.
   */
  async projectCanvasToScene(position: Point2D): Promise<Point2D> {
    return this.page.evaluate((canvasPosition) => {
      const editor = window.shiftSession?.editor;
      if (!editor) throw new Error("Expected editor");

      return editor.projectScreenToScene(canvasPosition);
    }, position);
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

  /** Returns the active glyph, or null until its authored layer is published. */
  async activeGlyph(): Promise<ActiveGlyph | null> {
    return this.page.evaluate(() => {
      const editor = window.shiftSession?.editor;
      const node = editor?.scene.nodesOfKind("glyph")[0];
      if (!editor || !node) return null;

      const glyph = editor.glyphForId(node.glyphId);
      const layer = glyph?.layerForSource(node.sourceId);
      if (!layer) return null;

      return {
        glyphId: node.glyphId,
        nodeId: node.id,
        sourceId: node.sourceId,
        pointCount: layer.pointCount,
        contourCount: layer.contours.length,
      };
    });
  }

  /** Returns zero without an active glyph, otherwise its authored point count. */
  async pointCount(): Promise<number> {
    return (await this.activeGlyph())?.pointCount ?? 0;
  }

  /** Returns zero without an active glyph, otherwise its authored contour count. */
  async contourCount(): Promise<number> {
    return (await this.activeGlyph())?.contourCount ?? 0;
  }

  /** Returns a fresh snapshot of the current selection identities. */
  async selectionIds(): Promise<readonly string[]> {
    return this.page.evaluate(() => window.shiftSession?.editor.selection.ids ?? []);
  }

  /** Returns the hovered editor object identity, or null when nothing is hovered. */
  async hoverId(): Promise<string | null> {
    return this.page.evaluate(() => window.shiftSession?.editor.hover.id ?? null);
  }

  /** Returns the active tool's published state discriminator. */
  async toolState(): Promise<string | null> {
    return this.page.evaluate(
      () => window.shiftSession?.editor.toolManager.activeTool?.getState().type ?? null,
    );
  }

  /** Returns fresh live selection bounds; throws without a bounded selection. */
  async selectionBounds(): Promise<Rect2D> {
    const bounds = await this.page.evaluate(() => window.shift?.editor.selectionBounds());
    if (!bounds) throw new Error("Expected selection bounds");

    return bounds;
  }

  /** Returns a fresh confirmed outline; throws without an authored layer. */
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
   * Returns fresh interaction targets; throws when a point is absent.
   * @param pointIds - Active-layer point identities in desired order.
   */
  async pointTargets(pointIds: readonly PointId[]): Promise<readonly PointTarget[]> {
    await this.#waitForEdits();

    return this.page.evaluate((ids) => {
      const editor = window.shift?.editor;
      const node = editor?.scene.nodesOfKind("glyph")[0];
      const layer = node ? editor?.glyphForId(node.glyphId)?.layerForSource(node.sourceId) : null;
      const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
      if (!editor || !node || !layer || !canvas) throw new Error("Expected editable glyph");

      const bounds = canvas.getBoundingClientRect();
      return ids.map((id) => {
        const point = layer.point(id);
        if (!point) throw new Error(`Expected editable point ${id}`);

        const canvasPosition = editor.projectSceneToScreen({
          x: point.x + node.position.x,
          y: point.y + node.position.y,
        });
        return {
          id,
          glyphPosition: { x: point.x, y: point.y },
          canvasPosition,
          pagePosition: {
            x: bounds.left + canvasPosition.x,
            y: bounds.top + canvasPosition.y,
          },
        };
      });
    }, pointIds);
  }

  /**
   * Returns a confirmed glyph-local position; throws when absent.
   * @param pointId - Point in the active authored layer.
   */
  async pointPosition(pointId: PointId): Promise<Point2D> {
    await this.#waitForEdits();
    return readLivePointPosition(this.page, pointId);
  }

  /**
   * Returns the current preview position without waiting for persistence.
   * @param pointId - Point in the active authored layer.
   */
  async livePointPosition(pointId: PointId): Promise<Point2D> {
    return readLivePointPosition(this.page, pointId);
  }

  /**
   * Selects one point through its rendered position; throws when absent.
   * @param pointId - Point in the active authored layer.
   */
  async clickPoint(pointId: PointId): Promise<void> {
    const [target] = await this.pointTargets([pointId]);

    await this.page.mouse.click(target.pagePosition.x, target.pagePosition.y);
    await this.page.waitForFunction(
      (id) =>
        window.shift?.editor.selection.ids.length === 1 && window.shift.editor.selection.has(id),
      pointId,
    );
  }

  /** Returns a safe drag for a visible on-curve point; throws when none exists. */
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
