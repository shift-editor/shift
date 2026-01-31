import type { Point2D } from "@shift/types";
import type { Editor } from "@/lib/editor";
import type { ToolSwitchHandler, TemporaryToolOptions } from "@/lib/editor/services";
import type { ToolName } from "./createContext";
import { GestureDetector, type ToolEvent, type Modifiers } from "./GestureDetector";
import { BaseTool, type ToolState } from "./BaseTool";
import type { DrawAPI } from "./DrawAPI";

export type ToolConstructor = new (editor: Editor) => BaseTool<ToolState>;

export class ToolManager implements ToolSwitchHandler {
  private registry = new Map<ToolName, ToolConstructor>();
  private primaryTool: BaseTool<ToolState> | null = null;
  private overrideTool: BaseTool<ToolState> | null = null;
  private gesture = new GestureDetector();
  private editor: Editor;

  private temporaryOptions: TemporaryToolOptions | null = null;

  constructor(editor: Editor) {
    this.editor = editor;
    editor.tools.setHandler(this);
  }

  get activeTool(): BaseTool<ToolState> | null {
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
  }

  handlePointerDown(screenPoint: Point2D, modifiers: Modifiers): void {
    const point = this.editor.projectScreenToUpm(screenPoint.x, screenPoint.y);
    this.gesture.pointerDown(point, screenPoint, modifiers);
  }

  handlePointerMove(screenPoint: Point2D, modifiers: Modifiers): void {
    const point = this.editor.projectScreenToUpm(screenPoint.x, screenPoint.y);
    const events = this.gesture.pointerMove(point, screenPoint, modifiers);
    this.dispatchEvents(events);
  }

  handlePointerUp(screenPoint: Point2D): void {
    const point = this.editor.projectScreenToUpm(screenPoint.x, screenPoint.y);
    const events = this.gesture.pointerUp(point, screenPoint);
    this.dispatchEvents(events);
  }

  handleKeyDown(e: KeyboardEvent): void {
    if (this.primaryTool?.handleModifier(e.code, true)) {
      e.preventDefault();
      return;
    }

    if (e.key === "Escape" && this.gesture.isDragging) {
      this.gesture.reset();
      this.activeTool?.handleEvent({ type: "dragCancel" });
      return;
    }

    this.activeTool?.handleEvent({
      type: "keyDown",
      key: e.key,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    });
  }

  handleKeyUp(e: KeyboardEvent): void {
    if (this.primaryTool?.handleModifier(e.code, false)) {
      return;
    }

    this.activeTool?.handleEvent({ type: "keyUp", key: e.key });
  }

  render(draw: DrawAPI): void {
    this.activeTool?.render?.(draw);
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
}
