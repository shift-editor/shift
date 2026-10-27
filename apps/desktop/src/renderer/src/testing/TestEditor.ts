/**
 * TestEditor — a real Editor with input simulation for testing.
 *
 * Usage:
 *   const editor = new TestEditor();
 *   editor.selectTool("pen");
 *   await editor.click(100, 200);
 *   expect(editor.pointCount).toBe(1);
 *
 * Editing sessions return when glyph mutations flow through workspace
 * change sets; until then the editor surface under test is tool/input state.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localPoint, scenePoint, screenPoint, type ScreenPoint } from "@shift/editor/spaces";
import { Editor } from "@shift/editor";
import {
  externalAxisLocationFromRecord,
  independentMappingFor,
  withIndependentMapping,
} from "@shift/editor/variation";
import type { AlignmentType, DistributeType } from "@shift/editor/transform";
import {
  kerningValueEdit,
  sourceMetricValue,
  withSourceMetricValue,
  type Glyph,
  type GlyphRenderModel,
  type GlyphLayer,
} from "@shift/editor/model";
import { Select, type ToolName } from "@shift/editor/tools";
import { registerBuiltInTools } from "@/lib/tools/tools";
import { runRendererCommand } from "@/lib/commands/rendererCommands";
import {
  alignSelection,
  distributeSelection,
  flipSelection,
  rotateSelection,
} from "@/lib/editor/sidebarActions";
import type { EditorCommandId } from "@shared/commands";
import { Bounds, Mat, type Point2D, type Rect2D } from "@shift/geo";
import {
  mintAxisMappingId,
  mintGlyphId,
  mintLayerId,
  type Axis,
  type AxisDefinition,
  type MetricId,
  type GlyphId,
  type MetricKind,
  type SelectableId,
  type GlyphName,
  type AnchorId,
  type AxisId,
  type GlyphRecord,
  type SourceMetrics,
  type ComponentId,
  type KerningGroupId,
  type KerningPosition,
  type SourceId,
  type PointId,
  type Unicode,
} from "@shift/types";
import type { Contour } from "@shift/glyph-state";
import type { SystemClipboard } from "@shift/editor/clipboard";
import { createWorkspaceStack, type WorkspaceStack } from "./workspaceStack";
import type { GlyphNode, PositionGuide, TextRunNode } from "@shift/editor/types";
import type { FontSessionMode, WorkspaceDocumentState } from "@shared/workspace/protocol";
import {
  contourContent,
  pointNames,
  type ComponentFixture,
  type GlyphFixture,
  type PointNames,
} from "./fixtures";
import type {
  AuthoredAnchor,
  AuthoredComponent,
  AuthoredLayer,
  AuthoredPoint,
  AxisCoordinate,
  FontOverview,
  GlyphSummary,
  KerningGroupSummary,
  KerningMasterValue,
  ResolvedGlyph,
  ResolvedLocation,
} from "@shift/runtime";
import { ShiftEditorReader } from "@/agent/ShiftEditorReader";
import { ShiftFontReader } from "@/agent/ShiftFontReader";
import { ShiftKerningReader } from "@/agent/ShiftKerningReader";
import type {
  AxisFixture,
  AxisLocation,
  AxisValues,
  DrawnGlyph,
  EditorTestSurface,
  Modifiers,
  Outline,
} from "./surface";
import { segmentIdFor } from "@shift/glyph-state";

const DEFAULT_MODIFIERS = { shiftKey: false, altKey: false, metaKey: false };

interface DragInput {
  down: Point2D;
  start: Point2D;
  end: Point2D;
  options?: Partial<typeof DEFAULT_MODIFIERS>;
}

interface DragResult {
  down: Point2D;
  start: Point2D;
  end: Point2D;
  delta: Point2D;
}

/**
 * In-memory {@link SystemClipboard} for tests. The buffer is directly
 * readable via {@link TestEditor.clipboardBuffer} so tests can assert on
 * what the Editor wrote without needing a round-trip.
 */
class InMemorySystemClipboard implements SystemClipboard {
  buffer = "";
  async writeText(text: string): Promise<void> {
    this.buffer = text;
  }
  async readText(): Promise<string> {
    return this.buffer;
  }
}

/**
 * Starts an editor with one open glyph, `A`, and returns it as the surface
 * behaviour tests use.
 */
export async function startTestEditor(
  sessionMode: FontSessionMode = "workspace",
): Promise<EditorTestSurface> {
  return new TestEditor(sessionMode).startSession();
}

/**
 * Opens a saved document with `glyphName` open, and returns it as the surface
 * behaviour tests use.
 */
export async function openTestEditor(
  sourcePath: string,
  glyphName: string,
): Promise<EditorTestSurface> {
  return new TestEditor().openSession(sourcePath, glyphName);
}

export class TestEditor extends Editor implements EditorTestSurface {
  readonly #clipboard: InMemorySystemClipboard;
  readonly #stack: WorkspaceStack;
  /** Temporary directories this editor's document was saved into, removed on {@link close}. */
  readonly #temporaryDirectories: string[] = [];
  /**
   * The agent readers MCP serves, over this editor: every surface read goes
   * through them, so a test sees what an agent sees.
   */
  readonly #reads: {
    readonly font: ShiftFontReader;
    readonly kerning: ShiftKerningReader;
    readonly editor: ShiftEditorReader;
  };
  /** The Kerning tool's uncommitted preview, discarded by {@link cancelGesture}. */
  #kerningPreview: ReturnType<Editor["font"]["beginKerningEdit"]> | null = null;

  /**
   * Creates a real editor stack with the requested immutable session capability.
   *
   * @param sessionMode - Presentation and interaction capability under test.
   */
  constructor(sessionMode: FontSessionMode = "workspace") {
    const stack = createWorkspaceStack();
    const clipboard = new InMemorySystemClipboard();
    super({ font: stack.font, fontStore: stack.store, clipboard, sessionMode });
    this.#stack = stack;
    this.#clipboard = clipboard;
    this.#reads = {
      font: new ShiftFontReader(stack.font, sessionMode),
      kerning: new ShiftKerningReader(stack.font),
      editor: new ShiftEditorReader(this, stack.editCoordinator.applyStatusCell),
    };
    registerBuiltInTools(this);
    this.setActiveTool("select");
  }

  /**
   * Creates a real workspace, a glyph, and places it in the editor scene —
   * the production pipe end to end (intents → NAPI → SQLite → echo → fold).
   */
  async startSession(name = "A", unicode: number | null = 65): Promise<this> {
    await this.#stack.createWorkspace();
    this.selectSource(this.font.defaultSource.id);

    const glyph = await this.#createAndOpenGlyph(name, unicode);
    const record = this.font.recordForName(glyph.handle.name);
    if (!record) throw new Error("created glyph did not appear in the font directory");
    this.#placeGlyph(record.id);
    return this;
  }

  /** Opens a saved package through a fresh workspace stack and places one glyph. */
  async openSession(sourcePath: string, glyphName: string): Promise<this> {
    await this.#stack.openWorkspace(sourcePath);
    this.selectSource(this.font.defaultSource.id);

    const record = this.font.recordForName(glyphName as GlyphName);
    if (!record) throw new Error(`Opened package has no ${glyphName} glyph`);
    await this.font.loadGlyph(record.id);
    this.#placeGlyph(record.id);
    return this;
  }

  /** The real renderer edit coordinator, for desktop components built around this editor. */
  get workspaceEditCoordinator(): WorkspaceStack["editCoordinator"] {
    return this.#stack.editCoordinator;
  }

  /** Flushes pending edits, saves to a new target, and adopts it. */
  saveAs(sourcePath: string): Promise<WorkspaceDocumentState> {
    return this.#stack.editCoordinator.save(sourcePath);
  }

  /** Makes the workspace fail the next edit it is sent, as a refused write would. */
  failNextWorkspaceApply(): void {
    this.#stack.failNextPersist();
  }

  /**
   * Flushes pending edits and saves to the current target; a document never
   * saved yet goes to a temporary file, removed on {@link close}.
   */
  async save(): Promise<WorkspaceDocumentState> {
    const state = await this.#stack.editCoordinator.state();
    if (!state?.needsSaveAs) return this.#stack.editCoordinator.save(null);

    const directory = mkdtempSync(join(tmpdir(), "shift-saved-"));
    this.#temporaryDirectories.push(directory);
    return this.saveAs(join(directory, "Saved.shift"));
  }

  /** Closes the clean workspace and permanently disposes this test stack. */
  async closeSession(): Promise<void> {
    await this.settle();
    await this.#stack.closeWorkspace();
    this.destroy();
    this.#stack.dispose();
  }

  /** Adds another glyph to the workspace font and loads its local model. */
  async addGlyph(name: string, unicode: number | null): Promise<void> {
    await this.#createAndOpenGlyph(name, unicode);
  }

  async #createAndOpenGlyph(name: string, unicode: number | null): Promise<Glyph> {
    const glyphId = mintGlyphId();
    const sourceId = this.font.defaultSource.id;
    const applied = await this.history.withoutRecording(() =>
      this.#stack.editCoordinator.apply([
        {
          kind: "createGlyph",
          createGlyph: {
            glyphId,
            name: name as GlyphName,
            unicodes: (unicode === null ? [] : [unicode]) as Unicode[],
          },
        },
        {
          kind: "createGlyphLayer",
          createGlyphLayer: {
            layerId: mintLayerId(),
            glyphId,
            sourceId,
          },
        },
      ]),
    );

    const record = applied.next?.glyphChanges?.updated.find((glyph) => glyph.name === name);
    if (!record) throw new Error("createGlyph did not echo the new record");

    return this.font.loadGlyph(record.id);
  }

  /** The canvas's text run; the editor route creates it on the first open. */
  get textRun(): TextRunNode | null {
    return this.scene.first("textRun");
  }

  /** The glyph edited in place in {@link textRun}. */
  get runGlyph(): GlyphNode | null {
    const run = this.textRun;
    return run ? this.nodeDefinition("textRun").childGlyph(run) : null;
  }

  /** Opens a glyph as the editor route does: the canvas run becomes that glyph, edited in place. */
  #placeGlyph(glyphId: GlyphId): void {
    const item = this.text.glyphItem(glyphId);
    if (!item || !this.glyphForId(glyphId)) throw new Error("placed glyph is not loaded");
    const record = this.text.createRun([item]);
    const run = this.scene.createNode<TextRunNode>({
      kind: "textRun",
      runId: record.id,
      size: this.font.metricsCell.peek().unitsPerEm,
      position: { x: 0, y: 0 },
    });
    const child = this.nodeDefinition("textRun").editItem(run, item.id);
    if (!child) throw new Error("placed glyph is not loaded");
    this.enterNode(child.id);
  }

  /**
   * Adds a weight axis and moves to a location between its default and maximum,
   * where no source sits, so the displayed glyph is interpolated and read-only.
   */
  async moveToInterpolatedLocation(): Promise<this> {
    const axisId = this.font.createAxis({
      tag: "wght",
      name: "Weight",
      role: "external",
      axisType: "continuous",
      minimum: 100,
      default: 400,
      maximum: 900,
      labels: [],
      hidden: false,
    });
    await this.settle();
    this.setExternalLocation(externalAxisLocationFromRecord({ [axisId]: 550 }));
    return this;
  }

  /**
   * Awaits every queued and in-flight apply, then text shaping and the glyph
   * loads it asks for; geometry and text reads see confirmed truth after.
   */
  async settle(): Promise<void> {
    await this.font.editCoordinator.settled();
    await this.text.settled();
  }

  get clipboardBuffer(): string {
    return this.#clipboard.buffer;
  }

  get pointCount(): number {
    return this.glyphLayer?.pointCount ?? 0;
  }

  get glyphLayer(): GlyphLayer | null {
    const sourceId = this.activeSourceId;
    if (!sourceId) return null;

    const node = this.glyphNode;
    if (!node) return null;

    return this.layerForGlyph(node.glyphId, sourceId) ?? null;
  }

  requireGlyphLayer(): GlyphLayer {
    const layer = this.glyphLayer;
    if (!layer) throw new Error("Expected glyph layer");

    return layer;
  }

  pointPosition(pointId: PointId): Point2D {
    this.#assertWorkspaceSettled();
    const point = this.requireGlyphLayer().point(pointId);
    if (!point) throw new Error("Expected source point");

    return { x: point.x, y: point.y };
  }

  anchorPosition(anchorId: AnchorId): Point2D {
    this.#assertWorkspaceSettled();
    const anchor = this.requireGlyphLayer().anchor(anchorId);
    if (!anchor) throw new Error("Expected source anchor");

    return { x: anchor.x, y: anchor.y };
  }

  async drawOpenContour(points: readonly Point2D[]): Promise<readonly PointId[]> {
    this.selectTool("pen");
    for (const point of points) {
      await this.clickLocal(point.x, point.y);
    }

    const contour = this.openContour;
    if (!contour) throw new Error("Expected open contour");

    return contour.points.map((point) => point.id);
  }

  get glyphNode(): GlyphNode | null {
    return this.scene.first("glyph");
  }

  get sceneGlyphRenderModel(): GlyphRenderModel | null {
    const node = this.glyphNode;
    if (!node) return null;

    return (
      this.glyphForId(node.glyphId)?.renderModelAt(
        this.externalLocationCell,
        this.activeSourceIdCell,
      ) ?? null
    );
  }

  get glyphRecord(): GlyphRecord | null {
    const node = this.glyphNode;
    if (!node) return null;

    return this.font.recordForId(node.glyphId);
  }

  get glyphContours(): readonly Contour[] {
    return this.glyphLayer?.contours ?? [];
  }

  get openContour(): Contour | null {
    return this.glyphContours.find((contour) => !contour.closed) ?? null;
  }

  async click(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): Promise<this> {
    const mods = { ...DEFAULT_MODIFIERS, ...options };
    this.toolManager.handlePointerDown(screenPoint(x, y), mods);
    this.toolManager.handlePointerUp(screenPoint(x, y), mods);

    await this.settle();
    return this;
  }

  /**
   * Projects a glyph-local (UPM) point to canvas pixels through the glyph node's
   * transform and the camera.
   *
   * @param point - a position in the placed glyph's own units, such as a point,
   * handle, or bounds value read from its layer.
   * @throws {Error} when no glyph node is open.
   */
  localToScreen(point: Point2D): ScreenPoint {
    const node = this.glyphNode;
    if (!node) throw new Error("localToScreen needs an open glyph node");

    return this.sceneToScreen(this.toScene(node, localPoint(point.x, point.y)));
  }

  /**
   * Clicks at glyph-local (UPM) coordinates, projecting through the glyph node and camera.
   *
   * @remarks
   * Use when a test asserts exact point positions; plain {@link click} takes
   * screen coordinates.
   */
  async clickLocal(
    x: number,
    y: number,
    options?: Partial<typeof DEFAULT_MODIFIERS>,
  ): Promise<this> {
    const screen = this.localToScreen({ x, y });
    return this.click(screen.x, screen.y, options);
  }

  /**
   * Drags through scene coordinates with a distinct threshold-crossing sample.
   *
   * @param input - Scene-space pointer-down origin, threshold-crossing first
   * move, and final pointer position.
   * @returns The scene-space drag points observed through the camera and the
   * canonical delta from `down` to `end`.
   */
  dragScene(input: DragInput): Promise<DragResult> {
    return this.#drag(
      input,
      (point) => this.sceneToScreen(scenePoint(point.x, point.y)),
      (screen) => this.screenToScene(screen),
    );
  }

  /**
   * Drags through the glyph node's own (UPM) coordinates with a distinct
   * threshold-crossing sample.
   *
   * @param input - Glyph-local pointer-down origin, threshold-crossing first
   * move, and final pointer position.
   * @returns The glyph-local drag points observed through the node and camera,
   * and the canonical delta from `down` to `end`.
   * @throws {Error} when no glyph node is open.
   */
  dragLocal(input: DragInput): Promise<DragResult> {
    const node = this.glyphNode;
    if (!node) throw new Error("dragLocal needs an open glyph node");

    return this.#drag(
      input,
      (point) => this.localToScreen(point),
      (screen) => this.toLocal(node, this.screenToScene(screen)),
    );
  }

  async #drag(
    input: DragInput,
    toScreen: (point: Point2D) => ScreenPoint,
    fromScreen: (screen: ScreenPoint) => Point2D,
  ): Promise<DragResult> {
    const downScreen = toScreen(input.down);
    const startScreen = toScreen(input.start);
    const endScreen = toScreen(input.end);

    this.pointerDown(downScreen.x, downScreen.y, input.options);
    this.pointerMove(startScreen.x, startScreen.y, input.options);
    this.pointerMove(endScreen.x, endScreen.y, input.options);
    this.pointerUp(endScreen.x, endScreen.y, input.options);

    await this.settle();

    const down = fromScreen(downScreen);
    const start = fromScreen(startScreen);
    const end = fromScreen(endScreen);

    return {
      down,
      start,
      end,
      delta: {
        x: end.x - down.x,
        y: end.y - down.y,
      },
    };
  }

  /**
   * Returns the selection's bounds in the glyph's own units as a rectangle.
   *
   * @returns null when nothing is selected or the selection spans nodes.
   */
  selectionLocalRect(): Rect2D | null {
    const bounds = this.selectionBounds();
    return bounds ? Bounds.toRect(bounds) : null;
  }

  pointerDown(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    this.toolManager.handlePointerDown(screenPoint(x, y), { ...DEFAULT_MODIFIERS, ...options });
    return this;
  }

  pointerMove(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    this.toolManager.handlePointerMove(
      screenPoint(x, y),
      { ...DEFAULT_MODIFIERS, ...options },
      { force: true },
    );
    this.toolManager.flushPointerMoves();
    return this;
  }

  pointerUp(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    this.toolManager.handlePointerUp(screenPoint(x, y), { ...DEFAULT_MODIFIERS, ...options });
    return this;
  }

  keyDown(key: string, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    const mods = { ...DEFAULT_MODIFIERS, ...options };
    this.toolManager.handleKeyDown({
      key,
      code: key,
      shiftKey: mods.shiftKey,
      altKey: mods.altKey,
      metaKey: mods.metaKey,
      ctrlKey: false,
      preventDefault: () => {},
    } as KeyboardEvent);
    return this;
  }

  async pressKey(key: string, options?: Partial<typeof DEFAULT_MODIFIERS>): Promise<void> {
    this.keyDown(key, options);

    await this.settle();
  }

  escape(): this {
    return this.keyDown("Escape");
  }

  selectTool(name: ToolName): this {
    this.setActiveTool(name);
    return this;
  }

  async draw<const F extends GlyphFixture>(fixture: F): Promise<Record<PointNames<F>, PointId>> {
    const names = {} as Record<PointNames<F>, PointId>;
    if (fixture.advance !== undefined) this.setXAdvance(fixture.advance);

    const contours = fixture.contours ?? [];
    if (contours.length > 0) {
      const ids = this.insertContent(contourContent(contours));
      if (!ids) throw new Error("draw needs one open glyph to draw into");
      pointNames(contours).forEach((name, index) => {
        if (name !== null) (names as Record<string, PointId>)[name] = ids[index] as PointId;
      });
    }

    for (const anchor of fixture.anchors ?? []) {
      if (!this.addAnchorAt({ x: anchor.x, y: anchor.y })) {
        throw new Error(`draw could not add anchor ${anchor.name}`);
      }
      const [anchorId] = this.selection.ids;
      if (anchorId) this.renameAnchor(anchorId as AnchorId, anchor.name);
    }

    for (const component of fixture.components ?? []) await this.#drawComponent(component);

    this.selection.clear();
    await this.settle();
    return names;
  }

  /** Adds a component and moves it as the sidebar's position fields do. */
  async #drawComponent(component: ComponentFixture): Promise<void> {
    const base = this.font.recordForName(component.glyph as GlyphName);
    if (!base) throw new Error(`draw needs a glyph named ${component.glyph}`);

    const id: ComponentId | null = await this.addComponent(base.id);
    if (!id) throw new Error(`draw could not add component ${component.glyph}`);

    const { x = 0, y = 0 } = component;
    if (x === 0 && y === 0) return;
    await this.settle();
    const selection = this.componentTransformSelection([id]);
    if (!selection) throw new Error(`draw could not move component ${component.glyph}`);
    selection.layer.transformComponents(selection, "Move components", () => Mat.Translate(x, y));
  }

  select(ids: readonly PointId[]): void {
    this.selection.select(ids);
  }

  async clickAt(position: Point2D, modifiers?: Modifiers): Promise<void> {
    await this.clickLocal(position.x, position.y, modifiers);
  }

  async dragPoint(id: PointId, by: Point2D, modifiers?: Modifiers): Promise<void> {
    await this.dragLocal(this.#pointDrag(id, by, modifiers));
  }

  holdDrag(id: PointId, by: Point2D, modifiers?: Modifiers): void {
    const drag = this.#pointDrag(id, by, modifiers);
    const down = this.localToScreen(drag.down);
    const start = this.localToScreen(drag.start);
    const end = this.localToScreen(drag.end);

    this.pointerDown(down.x, down.y, modifiers);
    this.pointerMove(start.x, start.y, modifiers);
    this.pointerMove(end.x, end.y, modifiers);
  }

  /** A drag from point `id` by `by`, crossing the drag threshold on a first sample a few units along. */
  #pointDrag(id: PointId, by: Point2D, options?: Modifiers): DragInput {
    const down = this.pointPosition(id);
    const length = Math.hypot(by.x, by.y) || 1;
    const lead = Math.min(4, length);
    return {
      down,
      start: { x: down.x + (by.x / length) * lead, y: down.y + (by.y / length) * lead },
      end: { x: down.x + by.x, y: down.y + by.y },
      options,
    };
  }

  cancelGesture(): void {
    this.toolManager.cancelPointerGesture();
    this.#kerningPreview?.discard();
    this.#kerningPreview = null;
  }

  setAdvanceWidth(width: number): void {
    this.setXAdvance(width);
  }

  pressAt(position: Point2D, modifiers?: Modifiers): void {
    const screen = this.localToScreen(position);
    this.pointerDown(screen.x, screen.y, modifiers);
  }

  movePointerTo(position: Point2D, modifiers?: Modifiers): void {
    const screen = this.localToScreen(position);
    this.pointerMove(screen.x, screen.y, modifiers);
  }

  queuePointerMove(position: Point2D, modifiers?: Modifiers): void {
    this.toolManager.handlePointerMove(this.localToScreen(position), {
      ...DEFAULT_MODIFIERS,
      ...modifiers,
    });
  }

  async releaseAt(position: Point2D, modifiers?: Modifiers): Promise<void> {
    const screen = this.localToScreen(position);
    this.pointerUp(screen.x, screen.y, modifiers);
    this.toolManager.flushPointerMoves();
    await this.settle();
  }

  async dragFrom(from: Point2D, to: Point2D, modifiers?: Modifiers): Promise<void> {
    await this.dragLocal(this.#dragBetween(from, to, modifiers));
  }

  /** A drag from `down` to `end`, crossing the drag threshold on a first sample a few units along. */
  #dragBetween(down: Point2D, end: Point2D, options?: Modifiers): DragInput {
    const by = { x: end.x - down.x, y: end.y - down.y };
    const length = Math.hypot(by.x, by.y) || 1;
    const lead = Math.min(4, length);
    return {
      down,
      start: { x: down.x + (by.x / length) * lead, y: down.y + (by.y / length) * lead },
      end,
      options,
    };
  }

  resizeCanvas(width: number, height: number): void {
    this.setCameraRect({
      x: 0,
      y: 0,
      width,
      height,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
    });
  }

  setTextSize(size: number): void {
    const run = this.#requireTextRun();
    this.scene.updateNode({ id: run.id, size });
  }

  moveText(to: Point2D): void {
    const run = this.#requireTextRun();
    this.scene.updateNode({ id: run.id, position: to });
  }

  #requireTextRun(): TextRunNode {
    const run = this.textRun;
    if (!run) throw new Error("The canvas has no text run");
    return run;
  }

  async duplicate(): Promise<boolean> {
    return runRendererCommand(this, "edit.duplicate");
  }

  async typeText(text: string): Promise<void> {
    this.textEditing.typeLiteral(text);
    await this.settle();
  }

  async advanceWidth(): Promise<number> {
    return (await this.#authoredLayer()).advanceWidth;
  }

  setKerning(source: string, first: string, second: string, amount: number | null): void {
    const sourceId = this.#sourceNamed(source);
    const [firstId, secondId] = [this.#glyphNamed(first), this.#glyphNamed(second)];
    const kerning = this.font.kerningCell.peek();
    if (amount === null) {
      const applied = kerning.resolve(sourceId, firstId, secondId);
      if (applied)
        this.font.setKerningValues([kerningValueEdit(sourceId, applied)], "Remove kerning");
      return;
    }
    const pair = kerning.editablePair(sourceId, firstId, secondId);
    this.font.setKerningValues([kerningValueEdit(sourceId, pair, amount)], "Change kerning");
  }

  previewKerning(source: string, first: string, second: string, amount: number): void {
    const sourceId = this.#sourceNamed(source);
    const pair = this.font.kerningCell
      .peek()
      .editablePair(sourceId, this.#glyphNamed(first), this.#glyphNamed(second));
    this.#kerningPreview ??= this.font.beginKerningEdit();
    this.#kerningPreview.preview([kerningValueEdit(sourceId, pair, amount)]);
  }

  async setKerningException(
    source: string,
    first: string,
    second: string,
    side: KerningPosition,
    locked: boolean,
  ): Promise<boolean> {
    const sourceId = this.#sourceNamed(source);
    const [firstId, secondId] = [this.#glyphNamed(first), this.#glyphNamed(second)];
    const kerning = this.font.kerningCell.peek();
    const pair = kerning.editablePair(sourceId, firstId, secondId);
    const edit = kerning.exceptionEdit(sourceId, firstId, secondId, pair, side, locked);
    if (!edit) return false;

    this.font.setKerningValues(
      [edit],
      locked ? "Make kerning exception" : "Remove kerning exception",
    );
    await this.settle();
    return true;
  }

  async createKerningGroup(
    position: KerningPosition,
    name: string,
    glyphs: readonly string[],
  ): Promise<void> {
    await this.font.createKerningGroup(
      position,
      name,
      glyphs.map((glyph) => this.#glyphNamed(glyph)),
    );
  }

  async moveToKerningGroup(
    position: KerningPosition,
    glyphs: readonly string[],
    group: string | null,
  ): Promise<void> {
    await this.font.assignKerningGroup(
      position,
      glyphs.map((glyph) => this.#glyphNamed(glyph)),
      group === null ? null : this.#kerningGroupNamed(position, group),
    );
  }

  async renameKerningGroup(
    position: KerningPosition,
    name: string,
    newName: string,
  ): Promise<void> {
    await this.font.renameKerningGroup(this.#kerningGroupNamed(position, name), newName);
  }

  async deleteKerningGroup(position: KerningPosition, name: string): Promise<void> {
    await this.font.deleteKerningGroup(this.#kerningGroupNamed(position, name));
  }

  addAxis(axis: AxisDefinition): void {
    this.font.createAxis(axis);
  }

  async setAxisMapping(
    axis: string,
    points: readonly (readonly [input: number, output: number])[],
  ): Promise<void> {
    const target = this.#axisTagged(axis);
    const mapping = {
      id: mintAxisMappingId(),
      name: `${target.name} mapping`,
      inputs: [target.id],
      outputs: [target.id],
      points: points.map(([input, output]) => ({
        input: { values: { [target.id]: input } },
        output: { values: { [target.id]: output } },
      })),
    };
    await this.font.setIndependentAxisMapping(target, mapping);
  }

  addSource(name: string, location: AxisValues): void {
    this.createSource(name, externalAxisLocationFromRecord(this.#axisValueRecord(location)));
  }

  switchToSource(name: string): void {
    this.selectSourceForEditing(this.#sourceNamed(name));
  }

  async setSourceMetric(source: string, metric: string, position: number): Promise<void> {
    const current = this.font.source(this.#sourceNamed(source));
    if (!current) throw new Error(`The font has no source named ${source}`);
    const value = sourceMetricValue(current, this.#metricNamed(metric));
    await this.font.updateSource(withSourceMetricValue(current, { ...value, position }));
  }

  addInstance(name: string, location: AxisValues): void {
    this.font.createNamedInstance({ name, location: { values: this.#axisValueRecord(location) } });
  }

  kerning(first: string, second: string): readonly KerningMasterValue[] {
    return this.#reads.kerning.resolve([{ first, second }], {}).items[0]!.masters;
  }

  kerningAt(source: string, first: string, second: string): KerningMasterValue | null {
    const sourceId = this.#sourceNamed(source);
    return this.kerning(first, second).find((master) => master.sourceId === sourceId) ?? null;
  }

  kerningGroup(position: KerningPosition, name: string): KerningGroupSummary | null {
    return this.kerningGroups(position).find((group) => group.name === name) ?? null;
  }

  kerningGroupOf(position: KerningPosition, glyph: string): KerningGroupSummary | null {
    return (
      this.kerningGroups(position).find((group) =>
        group.members.some((member) => member.name === glyph),
      ) ?? null
    );
  }

  kerningGroups(position: KerningPosition): readonly KerningGroupSummary[] {
    return this.#reads.kerning.groups(position);
  }

  #glyphNamed(name: string): GlyphId {
    const record = this.font.recordForName(name as GlyphName);
    if (!record) throw new Error(`The font has no glyph named ${name}`);
    return record.id;
  }

  #sourceNamed(name: string): SourceId {
    const source = this.font.sources.find((candidate) => candidate.name === name);
    if (!source) throw new Error(`The font has no source named ${name}`);
    return source.id;
  }

  #axisTagged(tag: string): Axis {
    const axis = this.font.getAxes().find((candidate) => candidate.tag === tag);
    if (!axis) throw new Error(`The font has no axis tagged ${tag}`);
    return axis;
  }

  #axisValueRecord(location: AxisValues): Record<string, number> {
    return Object.fromEntries(
      Object.entries(location).map(([tag, value]) => [this.#axisTagged(tag).id, value]),
    );
  }

  #axisCoordinates(location: AxisValues): AxisCoordinate[] {
    return Object.entries(location).map(([tag, value]) => ({
      axisId: this.#axisTagged(tag).id,
      value,
    }));
  }

  #metricNamed(name: string): MetricId {
    const definition = this.font.metricDefinitions.find((candidate) => candidate.name === name);
    if (!definition) throw new Error(`The font has no metric named ${name}`);
    return definition.id;
  }

  #kerningGroupNamed(position: KerningPosition, name: string): KerningGroupId {
    const group = this.font.kerningCell.peek().groups.named(position, name);
    if (!group) throw new Error(`The font has no ${position} kerning group named ${name}`);
    return group.id;
  }

  async outline(): Promise<Outline> {
    return (await this.#authoredLayer()).contours;
  }

  async point(id: PointId): Promise<AuthoredPoint | null> {
    const outline = await this.outline();
    return outline.flatMap((contour) => contour.points).find((point) => point.id === id) ?? null;
  }

  async anchors(): Promise<readonly AuthoredAnchor[]> {
    return (await this.#authoredLayer()).anchors;
  }

  async components(): Promise<readonly AuthoredComponent[]> {
    return (await this.#authoredLayer()).components;
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

  selectionIds(): readonly string[] {
    return this.#reads.editor.inspect("").selectionIds;
  }

  /**
   * The open glyph's authored layer at the active source, read as agents read it.
   *
   * @throws {Error} while edits are pending, or when no glyph is open.
   */
  async #authoredLayer(): Promise<AuthoredLayer> {
    this.#assertWorkspaceSettled();
    return this.#reads.font.getLayer(this.requireGlyphLayer().layerId);
  }

  shownCursor(): string {
    return this.cursor;
  }

  documentState(): Promise<WorkspaceDocumentState | null> {
    return this.font.editCoordinator.state();
  }

  fontOverview(): FontOverview {
    return this.#reads.font.getFont();
  }

  glyph(name: string): GlyphSummary {
    return this.#reads.font.getGlyph({ name: name as GlyphName });
  }

  locationAt(location: AxisValues): ResolvedLocation {
    return this.#reads.font.resolveLocation(this.#axisCoordinates(location));
  }

  async glyphAt(location: AxisValues): Promise<ResolvedGlyph | null> {
    const glyphId = this.glyphRecord?.id;
    if (!glyphId) throw new Error("glyphAt needs an open glyph");
    const resolved = await this.#reads.font.resolveGlyphs(
      [glyphId],
      this.#axisCoordinates(location),
    );
    return resolved.items[0] ?? null;
  }

  shownPointPositions(ids: readonly PointId[]): Record<PointId, Point2D> {
    const layer = this.requireGlyphLayer();
    return Object.fromEntries(
      ids.map((id) => {
        const point = layer.point(id);
        if (!point) throw new Error(`The open glyph shows no point ${id}`);
        return [id, { x: point.x, y: point.y }];
      }),
    ) as Record<PointId, Point2D>;
  }

  editGhost(ids: readonly PointId[]): Record<PointId, Point2D> | null {
    const ghost = this.requireGlyphLayer().editBaseGeometryCell.peek();
    if (!ghost) return null;
    return Object.fromEntries(
      ids.map((id) => {
        const point = ghost.point(id);
        if (!point) throw new Error(`The edit ghost shows no point ${id}`);
        return [id, { x: point.x, y: point.y }];
      }),
    ) as Record<PointId, Point2D>;
  }

  async outlineAt(source: string): Promise<Outline> {
    const glyph = this.glyphRecord;
    if (!glyph) throw new Error("outlineAt needs an open glyph");
    const layerId = this.font.layerIdFor(glyph.id, this.#sourceNamed(source));
    if (!layerId) throw new Error(`The open glyph has no layer at ${source}`);
    return (await this.#reads.font.getLayer(layerId)).contours;
  }

  segmentBetween(start: PointId, end: PointId): string {
    return segmentIdFor(start, end);
  }

  toolState(): string | null {
    return this.#reads.editor.inspect("").tool?.state ?? null;
  }

  toolCursor(): string {
    return this.toolManager.activeTool?.cursorCell.value.type ?? "default";
  }

  snapGuides(): readonly PositionGuide[] {
    const state = this.toolIf("select")?.state;
    return state?.type === "translating" ? state.translate.guides : [];
  }

  boundingBoxShown(): boolean {
    const tool = this.toolManager.activeTool;
    return tool instanceof Select && tool.boundingBox.visible;
  }

  hitDistance(): number {
    const node = this.glyphNode;
    if (!node) throw new Error("hitDistance needs an open glyph");
    return this.hitRadiusIn(node);
  }

  pixelSize(): number {
    return this.camera.screenToSceneDistance(1);
  }

  metrics(): SourceMetrics {
    return this.#reads.font.resolveLocation([]).metrics;
  }

  hoveredId(): string | null {
    return this.hover.id;
  }

  toolDisabled(name: ToolName): boolean {
    return this.toolRegistry.get(name)?.disabled ?? false;
  }

  targetAt(position: Point2D): string {
    return this.getPointerTarget(this.screenToScene(this.localToScreen(position))).kind;
  }

  textLength(): number {
    const run = this.#requireTextRun();
    return this.text.run(run.runId)?.items.length ?? 0;
  }

  async reopen(): Promise<EditorTestSurface> {
    const glyphName = this.glyphRecord?.name;
    if (!glyphName) throw new Error("reopen needs an open glyph");

    const directory = mkdtempSync(join(tmpdir(), "shift-reopen-"));
    await this.saveAs(join(directory, "Reopened.shift"));
    const reopened = new TestEditor();
    reopened.#temporaryDirectories.push(directory);
    return reopened.openSession(join(directory, "Reopened.shift"), glyphName);
  }

  /** Closes the document without saving and disposes the editor. */
  async close(): Promise<void> {
    await this.settle();
    await this.#stack.closeWorkspace(true);
    this.destroy();
    this.#stack.dispose();
    for (const directory of this.#temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  async openGlyph(name: string): Promise<void> {
    const glyphId = this.#glyphNamed(name);
    await this.font.loadGlyph(glyphId);
    if (!this.openGlyphInText(glyphId)) throw new Error(`${name} did not open`);
    await this.settle();
  }

  async addAxis(
    tag: string,
    range: { minimum: number; default: number; maximum: number },
  ): Promise<void> {
    this.font.createAxis({
      tag,
      name: tag,
      role: "external",
      axisType: "continuous",
      ...range,
      labels: [],
      hidden: false,
    });
    await this.settle();
  }

  async openGlyph(name: string): Promise<void> {
    const glyph = await this.font.loadGlyph(this.#glyphNamed(name));
    if (!this.openGlyphInPlace(glyph.id)) throw new Error(`openGlyph could not place ${name}`);
    await this.settle();
  }

  selectObjects(ids: readonly SelectableId[]): void {
    this.selection.select(ids);
  }

  async doubleClickAt(position: Point2D, modifiers?: Modifiers): Promise<void> {
    await this.clickLocal(position.x, position.y, modifiers);
    await this.clickLocal(position.x, position.y, modifiers);
  }

  hoverAt(position: Point2D): void {
    const screen = this.localToScreen(position);
    this.updateMousePosition(screen.x, screen.y);
    this.flushMousePosition();
  }

  async dragAnchor(id: AnchorId, by: Point2D, modifiers?: Modifiers): Promise<void> {
    await this.dragLocal(this.#dragFrom(this.anchorPosition(id), by, modifiers));
  }

  holdDragAnchor(id: AnchorId, by: Point2D, modifiers?: Modifiers): void {
    const drag = this.#dragFrom(this.anchorPosition(id), by, modifiers);
    for (const [index, point] of [drag.down, drag.start, drag.end].entries()) {
      const screen = this.localToScreen(point);
      if (index === 0) this.pointerDown(screen.x, screen.y, modifiers);
      else this.pointerMove(screen.x, screen.y, modifiers);
    }
  }

  /** A drag from `down` by `by`, crossing the drag threshold on a first sample a few units along. */
  #dragFrom(down: Point2D, by: Point2D, options?: Modifiers): DragInput {
    const length = Math.hypot(by.x, by.y) || 1;
    const lead = Math.min(4, length);
    return {
      down,
      start: { x: down.x + (by.x / length) * lead, y: down.y + (by.y / length) * lead },
      end: { x: down.x + by.x, y: down.y + by.y },
      options,
    };
  }

  async runCommand(id: EditorCommandId): Promise<boolean> {
    const handled = await runRendererCommand(this, id);
    await this.settle();
    return handled;
  }

  alignSelection(alignment: AlignmentType): boolean {
    return alignSelection(this, alignment);
  }

  distributeSelection(type: DistributeType): boolean {
    return distributeSelection(this, type);
  }

  flipSelection(axis: "horizontal" | "vertical"): boolean {
    return flipSelection(this, axis);
  }

  rotateSelection(degrees: number): boolean {
    return rotateSelection(this, degrees);
  }

  async addAxis(axis: AxisFixture): Promise<void> {
    this.font.createAxis({
      ...axis,
      role: "external",
      axisType: "continuous",
      labels: [],
      hidden: false,
    });
    await this.settle();
  }

  async addSource(name: string, location: Readonly<Record<string, number>>): Promise<void> {
    const byId = Object.fromEntries(
      Object.entries(location).map(([tag, value]) => [this.#axisTagged(tag), value]),
    );
    this.createSource(name, externalAxisLocationFromRecord(byId));
    await this.settle();
  }

  async mapAxis(
    tag: string,
    points: readonly (readonly [user: number, design: number])[],
  ): Promise<void> {
    const axisId = this.#axisTagged(tag);
    const axis = this.font.getAxes().find((candidate) => candidate.id === axisId)!;
    const mapping = independentMappingFor(this.font.getAxisMappings(), axis);
    await this.font.setAxisMappings(
      withIndependentMapping(this.font.getAxisMappings(), axis, {
        id: mapping?.id ?? mintAxisMappingId(),
        name: mapping?.name ?? tag,
        inputs: [axisId],
        outputs: [axisId],
        points: points.map(([user, design]) => ({
          input: { values: { [axisId]: user } },
          output: { values: { [axisId]: design } },
        })),
      }),
    );
    await this.settle();
  }

  async addSource(name: string, location: AxisLocation): Promise<void> {
    this.createSource(name, externalAxisLocationFromRecord(this.#axisValues(location)));
    await this.settle();
  }

  async setSourceMetric(source: string, metric: MetricKind, position: number): Promise<void> {
    const current = this.font.source(this.#sourceNamed(source));
    const definition = this.font.metricDefinitions.find(({ kind }) => kind === metric);
    if (!current || !definition) throw new Error(`The font has no ${metric} for ${source}`);

    await this.font.updateSource({
      ...current,
      metricValues: current.metricValues.map((value) =>
        value.metricId === definition.id ? { ...value, position } : value,
      ),
    });
    await this.settle();
  }

  async editSources(names: readonly string[]): Promise<void> {
    const [first, ...rest] = names;
    if (first === undefined) throw new Error("editSources needs at least one source");
    this.selectSourceForEditing(this.#sourceNamed(first));
    for (const name of rest) this.selectSourceForEditing(this.#sourceNamed(name), "toggle");
    await this.settle();
  }

  #axisTagged(tag: string): AxisId {
    const axis = this.#reads.font.getFont().axes.find((candidate) => candidate.tag === tag);
    if (!axis) throw new Error(`The font has no axis tagged ${tag}`);
    return axis.id;
  }

  async editSources(names: readonly string[]): Promise<void> {
    const [first, ...rest] = names.map((name) => this.#sourceNamed(name));
    if (!first) throw new Error("editSources needs at least one source");

    this.selectSourceForEditing(first);
    for (const sourceId of rest) this.selectSourceForEditing(sourceId, "toggle");
    await this.settle();
    await this.editingLayersMatched();
  }

  setLocation(location: AxisLocation): void {
    this.setExternalLocation(externalAxisLocationFromRecord(this.#axisValues(location)));
  }

  #axisTagged(tag: string): AxisId {
    const axis = this.font.getAxes().find((candidate) => candidate.tag === tag);
    if (!axis) throw new Error(`The font has no axis tagged ${tag}`);
    return axis.id;
  }

  #axisValues(location: AxisLocation): Record<AxisId, number> {
    return Object.fromEntries(
      Object.entries(location).map(([tag, value]) => [this.#axisTagged(tag), value]),
    ) as Record<AxisId, number>;
  }

  async layerAt(source: string): Promise<AuthoredLayer> {
    this.#assertWorkspaceSettled();
    const node = this.glyphNode;
    const layerId = node ? this.font.layerIdFor(node.glyphId, this.#sourceNamed(source)) : null;
    if (!layerId) throw new Error(`The open glyph has no layer in ${source}`);
    return this.#reads.font.getLayer(layerId);
  }

  async pointAt(position: Point2D): Promise<AuthoredPoint | null> {
    const outline = await this.outline();
    return (
      outline
        .flatMap((contour) => contour.points)
        .find((point) => point.x === position.x && point.y === position.y) ?? null
    );
  }

  async anchorNamed(name: string): Promise<AuthoredAnchor | null> {
    return (await this.anchors()).find((anchor) => anchor.name === name) ?? null;
  }

  glyphNamed(name: string): GlyphSummary | null {
    if (!this.font.entryForName(name as GlyphName)) return null;
    return this.#reads.font.getGlyph({ name: name as GlyphName });
  }

  fontOverview(): FontOverview {
    return this.#reads.font.getFont();
  }

  location(): ResolvedLocation {
    return this.#reads.font.resolveLocation(
      [...this.externalLocation].map(([axisId, value]) => ({ axisId, value })),
    );
  }

  async drawnGlyph(glyph?: string): Promise<DrawnGlyph> {
    const model =
      glyph === undefined
        ? this.sceneGlyphRenderModel
        : (await this.font.loadGlyph(this.#glyphNamed(glyph))).renderModelAt(
            this.externalLocationCell,
            this.activeSourceIdCell,
          );
    if (!model) throw new Error("drawnGlyph needs an open glyph");

    const { lsb, rsb } = model.sidebearings;
    return {
      advanceWidth: model.xAdvance,
      bounds: plainBounds(model.bounds),
      sidebearings: { lsb, rsb },
      components: model.components.map((component) => ({
        glyph: this.font.entryForId(component.glyphId)?.name ?? component.glyphId,
        dx: component.transform.e,
        dy: component.transform.f,
        bounds: plainBounds(component.bounds),
      })),
      anchors: model.anchorsWithComponents.map(({ name, x, y }) => ({ name, x, y })),
    };
  }

  asEditor(): Editor {
    return this;
  }

  #assertWorkspaceSettled(): void {
    if (!this.font.editCoordinator.settledCell.value) {
      throw new Error("Workspace edits are pending; await the user action before reading geometry");
    }
  }
}

function plainBounds(bounds: Bounds | null): Bounds | null {
  return bounds && { min: { ...bounds.min }, max: { ...bounds.max } };
}
