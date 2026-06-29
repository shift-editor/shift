import type { Point2D } from "@shift/geo";
import type { Editor } from "@/lib/editor/Editor";
import type { ToolSwitchHandler, TemporaryToolOptions } from "@/types/editor";
import type { ToolName } from "./createContext";
import {
  GestureDetector,
  normalizeModifiers,
  type GestureEvent,
  type ToolEvent,
  type Modifiers,
} from "./GestureDetector";
import type { BaseTool } from "./BaseTool";
import type { Canvas } from "@/lib/editor/rendering/Canvas";
import type { ToolManifest } from "./ToolManifest";
import { signal, type Signal, type WritableSignal } from "@/lib/signals";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolInstance = BaseTool<any, any, any>;

const DEFAULT_MODIFIERS: Modifiers = {
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  accelKey: false,
};

export class ToolManager implements ToolSwitchHandler {
  private registry = new Map<ToolName, ToolManifest>();
  private primaryTool: ToolInstance | null = null;
  private overrideTool: ToolInstance | null = null;
  readonly #activeTool: WritableSignal<ToolInstance | null>;
  private gesture = new GestureDetector();
  private editor: Editor;

  private temporaryOptions: TemporaryToolOptions | null = null;

  private pendingPointerMove: {
    screenPoint: Point2D;
    modifiers: Modifiers;
  } | null = null;
  private frameId: number | null = null;
  private lastScreenPoint: Point2D | null = null;

  constructor(editor: Editor) {
    this.editor = editor;
    this.#activeTool = signal<ToolInstance | null>(null, {
      name: "toolManager.activeTool",
    });
  }

  get activeTool(): ToolInstance | null {
    return this.#activeTool.peek();
  }

  get activeToolCell(): Signal<ToolInstance | null> {
    return this.#activeTool;
  }

  get activeToolId(): ToolName | null {
    return this.activeTool?.id ?? null;
  }

  get primaryToolId(): ToolName | null {
    return this.primaryTool?.id ?? null;
  }

  get isDragging(): boolean {
    return this.editor.gesture.isDragging;
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
    this.editor.gesture.reset();

    const nextTool = this.createToolInstance(id);
    if (!nextTool) {
      console.warn(`[ToolManager] Unknown tool: ${id}`);
      return;
    }

    this.primaryTool = nextTool;
    if (this.primaryTool.activate) this.primaryTool.activate();

    this.editor.setActiveToolState(this.primaryTool.getState());
    this.#publishActiveTool();
  }

  requestTemporary(toolId: ToolName, options?: TemporaryToolOptions): void {
    if (this.overrideTool || this.editor.gesture.isDragging) return;

    const nextTool = this.createToolInstance(toolId);
    if (!nextTool) return;

    this.temporaryOptions = options ?? null;
    this.overrideTool = nextTool;
    if (this.overrideTool.activate) this.overrideTool.activate();
    this.editor.setActiveToolState(this.overrideTool.getState());
    this.#publishActiveTool();
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
    this.#publishActiveTool();
  }

  handlePointerDown(screenPoint: Point2D, modifiers: Modifiers): void {
    const coords = this.editor.fromScreen(screenPoint);
    this.editor.input.setModifiers(modifiers);
    this.editor.input.setPointer(coords);
    this.editor.gesture.setPressed();
    this.gesture.pointerDown(coords, modifiers);
  }

  handlePointerMove(
    screenPoint: Point2D,
    modifiers: Modifiers,
    options?: { force?: boolean },
  ): void {
    const force = options?.force ?? false;
    if (
      !force &&
      this.lastScreenPoint &&
      screenPoint.x === this.lastScreenPoint.x &&
      screenPoint.y === this.lastScreenPoint.y
    ) {
      return;
    }

    this.lastScreenPoint = screenPoint;

    this.pendingPointerMove = { screenPoint, modifiers };

    if (!this.frameId) {
      this.frameId = requestAnimationFrame(() => this.flushPointerMove());
    }
  }

  /**
   * Drain any pending pointer-move synchronously.
   *
   * `handlePointerMove` normally coalesces calls via `requestAnimationFrame`.
   * Tests and automation that need the full move pipeline (input state →
   * gesture → tool event → state signal → cursor effect) to complete before
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

    const { screenPoint, modifiers } = this.pendingPointerMove;
    this.pendingPointerMove = null;

    const coords = this.editor.fromScreen(screenPoint);
    this.editor.input.setModifiers(modifiers);
    this.editor.input.setPointer(coords);

    const events = this.gesture.pointerMove(coords, modifiers);
    if (this.gesture.isDragging) this.editor.gesture.setDragging();
    this.dispatchEvents(events);
  }

  handlePointerUp(screenPoint: Point2D, modifiers: Modifiers = DEFAULT_MODIFIERS): void {
    const coords = this.editor.fromScreen(screenPoint);
    this.editor.input.setModifiers(modifiers);
    this.editor.input.setPointer(coords);
    const events = this.gesture.pointerUp(coords, modifiers);
    this.dispatchEvents(events);
    this.editor.gesture.reset();
  }

  handleKeyDown(e: KeyboardEvent): boolean {
    const modifiers = normalizeModifiers({
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
    });
    this.editor.input.setModifiers(modifiers);

    if (e.key === "Escape" && this.gesture.isDragging) {
      this.gesture.reset();
      this.editor.gesture.reset();
      this.activeTool?.handleEvent({ type: "dragCancel" });
      return true;
    }

    return (
      this.activeTool?.handleEvent({
        type: "keyDown",
        key: e.key,
        ...modifiers,
      }) ?? false
    );
  }

  handleKeyUp(e: KeyboardEvent): boolean {
    const modifiers = normalizeModifiers({
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
    });
    this.editor.input.setModifiers(modifiers);

    return (
      this.activeTool?.handleEvent({
        type: "keyUp",
        key: e.key,
        ...modifiers,
      }) ?? false
    );
  }

  drawBackground(canvas: Canvas): void {
    if (this.activeTool?.drawBackground) this.activeTool.drawBackground(canvas);
  }

  drawScene(canvas: Canvas): void {
    if (this.activeTool?.drawScene) this.activeTool.drawScene(canvas);
  }

  drawOverlay(canvas: Canvas): void {
    if (this.activeTool?.drawOverlay) this.activeTool.drawOverlay(canvas);
  }

  private dispatchEvents(events: GestureEvent[]): void {
    for (const event of events) {
      this.activeTool?.handleEvent(this.withPointerTarget(event));
    }
  }

  private withPointerTarget(event: GestureEvent): ToolEvent {
    switch (event.type) {
      case "pointerMove":
      case "click":
      case "doubleClick":
      case "dragStart":
      case "drag":
      case "dragEnd":
        return {
          ...event,
          target: this.editor.getPointerTarget(event.coords.scene),
        };
      case "dragCancel":
      case "keyDown":
      case "keyUp":
      case "selectionChanged":
        return event;
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
    this.#publishActiveTool();
  }

  /** @knipclassignore */
  reset(): void {
    this.gesture.reset();
    this.editor.gesture.reset();
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

  #publishActiveTool(): void {
    this.#activeTool.set(this.overrideTool ?? this.primaryTool);
  }
}
