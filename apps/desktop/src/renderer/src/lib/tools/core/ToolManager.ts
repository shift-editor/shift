import type { Point2D } from "@shift/types";
import type { EditorAPI } from "./EditorAPI";
import type { ToolSwitchHandler, TemporaryToolOptions } from "@/types/editor";
import type { ToolName } from "./createContext";
import { GestureDetector, type ToolEvent, type Modifiers } from "./GestureDetector";
import { BaseTool, type ToolState } from "./BaseTool";
import type { DrawAPI } from "./DrawAPI";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolConstructor = new (editor: EditorAPI) => BaseTool<ToolState, any>;

export class ToolManager implements ToolSwitchHandler {
  private registry = new Map<ToolName, ToolConstructor>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private primaryTool: BaseTool<ToolState, any> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private overrideTool: BaseTool<ToolState, any> | null = null;
  private gesture = new GestureDetector();
  private editor: EditorAPI;

  private temporaryOptions: TemporaryToolOptions | null = null;

  private pendingPointerMove: { screenPoint: Point2D; modifiers: Modifiers } | null = null;
  private frameId: number | null = null;
  private lastScreenPoint: Point2D | null = null;

  constructor(editor: EditorAPI) {
    this.editor = editor;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get activeTool(): BaseTool<ToolState, any> | null {
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

  register(id: ToolName, ToolClass: ToolConstructor): void {
    this.registry.set(id, ToolClass);
  }

  activate(id: ToolName): void {
    if (this.overrideTool) {
      this.releaseOverride();
    }

    this.primaryTool?.deactivate?.();
    this.gesture.reset();

    const ToolClass = this.registry.get(id);
    if (!ToolClass) {
      console.warn(`[ToolManager] Unknown tool: ${id}`);
      return;
    }

    this.primaryTool = new ToolClass(this.editor);
    this.primaryTool.activate?.();
    this.editor.setActiveToolState(this.primaryTool.getState());
    if (this.primaryTool.renderBelowHandles) {
      this.editor.requestStaticRedraw();
    }
  }

  requestTemporary(toolId: ToolName, options?: TemporaryToolOptions): void {
    if (this.overrideTool || this.gesture.isDragging) return;

    const ToolClass = this.registry.get(toolId);
    if (!ToolClass) return;

    this.temporaryOptions = options ?? null;
    this.overrideTool = new ToolClass(this.editor);
    this.overrideTool.activate?.();
    this.editor.setActiveToolState(this.overrideTool.getState());
    this.temporaryOptions?.onActivate?.();
  }

  returnFromTemporary(): void {
    if (!this.overrideTool) return;

    this.overrideTool.deactivate?.();
    this.overrideTool = null;
    this.temporaryOptions?.onReturn?.();
    this.temporaryOptions = null;

    if (this.primaryTool) {
      this.editor.setActiveToolState(this.primaryTool.getState());
    }
  }

  handlePointerDown(screenPoint: Point2D, modifiers: Modifiers): void {
    this.editor.setCurrentModifiers?.(modifiers);
    const coords = this.editor.fromScreen(screenPoint.x, screenPoint.y);
    this.gesture.pointerDown(coords, screenPoint, modifiers);
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

  private flushPointerMove(): void {
    this.frameId = null;

    this.editor.flushMousePosition?.();

    if (!this.pendingPointerMove) return;

    const { screenPoint, modifiers } = this.pendingPointerMove;
    this.pendingPointerMove = null;

    this.editor.setCurrentModifiers?.(modifiers);

    const coords = this.editor.fromScreen(screenPoint.x, screenPoint.y);
    const events = this.gesture.pointerMove(coords, screenPoint, modifiers);
    this.dispatchEvents(events);

    if (!this.gesture.isDragging) {
      this.editor.updateHover(coords);
    }

    if (this.activeTool?.renderBelowHandles) {
      this.editor.requestStaticRedraw();
    }
  }

  handlePointerUp(screenPoint: Point2D): void {
    const coords = this.editor.fromScreen(screenPoint.x, screenPoint.y);
    const events = this.gesture.pointerUp(coords, screenPoint);
    this.dispatchEvents(events);
  }

  handleKeyDown(e: KeyboardEvent): boolean {
    this.editor.setCurrentModifiers?.({
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    });

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
        metaKey: e.metaKey,
      }) ?? false
    );
  }

  handleKeyUp(e: KeyboardEvent): boolean {
    this.editor.setCurrentModifiers?.({
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    });

    return (
      this.activeTool?.handleEvent({
        type: "keyUp",
        key: e.key,
      }) ?? false
    );
  }

  render(draw: DrawAPI): void {
    this.activeTool?.render?.(draw);
  }

  renderBelowHandles(draw: DrawAPI): void {
    this.activeTool?.renderBelowHandles?.(draw);
  }

  private dispatchEvents(events: ToolEvent[]): void {
    for (const event of events) {
      this.activeTool?.handleEvent(event);
    }
  }

  private releaseOverride(): void {
    this.overrideTool?.deactivate?.();
    this.overrideTool = null;
    this.temporaryOptions?.onReturn?.();
    this.temporaryOptions = null;
    this.primaryTool?.activate?.();
    this.editor.setActiveToolState(this.primaryTool.getState());
  }

  reset(): void {
    this.gesture.reset();
    if (this.overrideTool) {
      this.releaseOverride();
    }
  }

  notifySelectionChanged(): void {
    this.activeTool?.handleEvent({ type: "selectionChanged" });
  }

  destroy(): void {
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.pendingPointerMove = null;
    this.lastScreenPoint = null;
  }
}
