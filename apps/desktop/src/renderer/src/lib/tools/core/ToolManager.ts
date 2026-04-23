import type { Point2D } from "@shift/types";
import type { Editor } from "@/lib/editor/Editor";
import type { ToolSwitchHandler, TemporaryToolOptions } from "@/types/editor";
import type { ToolName } from "./createContext";
import { GestureDetector, type ToolEvent, type Modifiers } from "./GestureDetector";
import type { BaseTool } from "./BaseTool";
import type { Canvas } from "@/lib/editor/rendering/Canvas";
import type { ToolManifest } from "./ToolManifest";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolInstance = BaseTool<any, any>;

export class ToolManager implements ToolSwitchHandler {
  private registry = new Map<ToolName, ToolManifest>();
  private primaryTool: ToolInstance | null = null;
  private overrideTool: ToolInstance | null = null;
  private gesture = new GestureDetector();
  private editor: Editor;

  private temporaryOptions: TemporaryToolOptions | null = null;

  private pendingPointerMove: {
    screenPoint: Point2D;
    modifiers: Modifiers;
    skipHover: boolean;
  } | null = null;
  private frameId: number | null = null;
  private lastScreenPoint: Point2D | null = null;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  get activeTool(): ToolInstance | null {
    return this.overrideTool ?? this.primaryTool;
  }

  get activeToolId(): ToolName | null {
    return this.activeTool?.id ?? null;
  }

  get primaryToolId(): ToolName | null {
    return this.primaryTool?.id ?? null;
  }

  get isDragging(): boolean {
    return this.gesture.isDragging;
  }

  register(manifest: ToolManifest): void {
    if (typeof manifest.id !== "string" || manifest.id.trim() === "") {
      throw new Error("[ToolManager] Tool id must be a non-empty string");
    }
    if (this.registry.has(manifest.id)) {
      throw new Error(`[ToolManager] Tool already registered: ${manifest.id}`);
    }
    this.registry.set(manifest.id, manifest);
  }

  activate(id: ToolName): void {
    if (this.overrideTool) {
      this.releaseOverride();
    }

    if (this.primaryTool?.deactivate) this.primaryTool.deactivate();
    this.gesture.reset();

    const nextTool = this.createToolInstance(id);
    if (!nextTool) {
      console.warn(`[ToolManager] Unknown tool: ${id}`);
      return;
    }

    this.primaryTool = nextTool;
    if (this.primaryTool.activate) this.primaryTool.activate();
    this.editor.setActiveToolState(this.primaryTool.getState());
    if (this.needsStaticRedrawOnActivation()) {
      this.editor.requestSceneRedraw();
    }
  }

  requestTemporary(toolId: ToolName, options?: TemporaryToolOptions): void {
    if (this.overrideTool || this.gesture.isDragging) return;

    const nextTool = this.createToolInstance(toolId);
    if (!nextTool) return;

    this.temporaryOptions = options ?? null;
    this.overrideTool = nextTool;
    if (this.overrideTool.activate) this.overrideTool.activate();
    this.editor.setActiveToolState(this.overrideTool.getState());
    if (this.temporaryOptions?.onActivate) this.temporaryOptions.onActivate();
  }

  returnFromTemporary(): void {
    if (!this.overrideTool) return;

    if (this.overrideTool.deactivate) this.overrideTool.deactivate();
    this.overrideTool = null;
    if (this.temporaryOptions?.onReturn) this.temporaryOptions.onReturn();
    this.temporaryOptions = null;

    if (this.primaryTool) {
      this.editor.setActiveToolState(this.primaryTool.getState());
    }
  }

  handlePointerDown(screenPoint: Point2D, modifiers: Modifiers): void {
    if (this.editor.setCurrentModifiers) this.editor.setCurrentModifiers(modifiers);
    const coords = this.editor.fromScreen(screenPoint);
    this.gesture.pointerDown(coords, screenPoint, modifiers);
  }

  handlePointerMove(
    screenPoint: Point2D,
    modifiers: Modifiers,
    options?: { force?: boolean; skipHover?: boolean },
  ): void {
    const force = options?.force ?? false;
    const skipHover = options?.skipHover ?? false;
    if (
      !force &&
      this.lastScreenPoint &&
      screenPoint.x === this.lastScreenPoint.x &&
      screenPoint.y === this.lastScreenPoint.y
    ) {
      return;
    }
    this.lastScreenPoint = screenPoint;

    this.pendingPointerMove = { screenPoint, modifiers, skipHover };

    if (!this.frameId) {
      this.frameId = requestAnimationFrame(() => this.flushPointerMove());
    }
  }

  /**
   * Drain any pending pointer-move synchronously.
   *
   * `handlePointerMove` normally coalesces calls via `requestAnimationFrame`.
   * Tests and automation that need the full move pipeline (gesture → tool
   * event → state signal → cursor effect → hover update) to complete before
   * the next action call this to bypass rAF.
   */
  flushPointerMoves(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.flushPointerMove();
  }

  private flushPointerMove(): void {
    this.frameId = null;

    if (this.editor.flushMousePosition) this.editor.flushMousePosition();

    if (!this.pendingPointerMove) return;

    const { screenPoint, modifiers, skipHover } = this.pendingPointerMove;
    this.pendingPointerMove = null;

    if (this.editor.setCurrentModifiers) this.editor.setCurrentModifiers(modifiers);

    const coords = this.editor.fromScreen(screenPoint);
    const events = this.gesture.pointerMove(coords, screenPoint, modifiers);
    this.dispatchEvents(events);

    if (!this.gesture.isDragging && !skipHover) {
      this.editor.updateHover(coords);
    }

    if (this.activeTool?.renderOverlay) {
      this.editor.requestOverlayRedraw();
    }
  }

  handlePointerUp(screenPoint: Point2D): void {
    const coords = this.editor.fromScreen(screenPoint);
    const events = this.gesture.pointerUp(coords, screenPoint);
    this.dispatchEvents(events);
  }

  handleKeyDown(e: KeyboardEvent): boolean {
    if (this.editor.setCurrentModifiers) {
      this.editor.setCurrentModifiers({
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey || e.ctrlKey,
      });
    }

    if (e.key === "Escape" && this.gesture.isDragging) {
      this.gesture.reset();
      this.activeTool?.handleEvent({ type: "dragCancel" });
      return true;
    }

    return (
      this.activeTool?.handleEvent({
        type: "keyDown",
        key: e.key,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey || e.ctrlKey,
      }) ?? false
    );
  }

  handleKeyUp(e: KeyboardEvent): boolean {
    if (this.editor.setCurrentModifiers) {
      this.editor.setCurrentModifiers({
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey || e.ctrlKey,
      });
    }

    return (
      this.activeTool?.handleEvent({
        type: "keyUp",
        key: e.key,
      }) ?? false
    );
  }

  renderBackground(canvas: Canvas): void {
    if (this.activeTool?.renderBackground) this.activeTool.renderBackground(canvas);
  }

  renderScene(canvas: Canvas): void {
    if (this.activeTool?.renderScene) this.activeTool.renderScene(canvas);
  }

  renderOverlay(canvas: Canvas): void {
    if (this.activeTool?.renderOverlay) this.activeTool.renderOverlay(canvas);
  }

  private dispatchEvents(events: ToolEvent[]): void {
    for (const event of events) {
      this.activeTool?.handleEvent(event);
    }
  }

  private releaseOverride(): void {
    if (this.overrideTool?.deactivate) this.overrideTool.deactivate();
    this.overrideTool = null;
    if (this.temporaryOptions?.onReturn) this.temporaryOptions.onReturn();
    this.temporaryOptions = null;
    if (this.primaryTool?.activate) this.primaryTool.activate();
    if (this.primaryTool) {
      this.editor.setActiveToolState(this.primaryTool.getState());
    }
  }

  /** @knipclassignore */
  reset(): void {
    this.gesture.reset();
    if (this.overrideTool) {
      this.releaseOverride();
    }
  }

  notifySelectionChanged(): void {
    this.activeTool?.handleEvent({ type: "selectionChanged" });
  }

  private createToolInstance(id: ToolName): ToolInstance | null {
    const manifest = this.registry.get(id);
    if (!manifest) return null;
    return manifest.create(this.editor);
  }

  private needsStaticRedrawOnActivation(): boolean {
    return !!this.primaryTool?.renderScene;
  }
}
