import type { Point2D } from "@shift/types";
import type { EditorAPI } from "./EditorAPI";
import type { ToolSwitchHandler, TemporaryToolOptions } from "@/types/editor";
import type { ToolName } from "./createContext";
import { GestureDetector, type ToolEvent, type Modifiers } from "./GestureDetector";
import type { BaseTool, ToolState } from "./BaseTool";
import type { DrawAPI } from "./DrawAPI";
import type { ToolManifest } from "./ToolManifest";
import type { ToolRenderContext, ToolRenderLayer } from "./ToolRenderContributor";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolInstance = BaseTool<ToolState, any>;
const STATIC_RENDER_LAYERS: readonly ToolRenderLayer[] = [
  "static-scene-before-handles",
  "static-screen-after-handles",
];
function isStaticRenderLayer(layer: ToolRenderLayer): boolean {
  return STATIC_RENDER_LAYERS.includes(layer);
}

export class ToolManager implements ToolSwitchHandler {
  private registry = new Map<ToolName, ToolManifest>();
  private primaryTool: ToolInstance | null = null;
  private overrideTool: ToolInstance | null = null;
  private gesture = new GestureDetector();
  private editor: EditorAPI;

  private temporaryOptions: TemporaryToolOptions | null = null;

  private pendingPointerMove: { screenPoint: Point2D; modifiers: Modifiers } | null = null;
  private frameId: number | null = null;
  private lastScreenPoint: Point2D | null = null;

  constructor(editor: EditorAPI) {
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

    this.primaryTool?.deactivate?.();
    this.gesture.reset();

    const nextTool = this.createToolInstance(id);
    if (!nextTool) {
      console.warn(`[ToolManager] Unknown tool: ${id}`);
      return;
    }

    this.primaryTool = nextTool;
    this.primaryTool.activate?.();
    this.editor.setActiveToolState(this.primaryTool.getState());
    if (this.needsStaticRedrawOnActivation()) {
      this.editor.requestStaticRedraw();
    }
  }

  requestTemporary(toolId: ToolName, options?: TemporaryToolOptions): void {
    if (this.overrideTool || this.gesture.isDragging) return;

    const nextTool = this.createToolInstance(toolId);
    if (!nextTool) return;

    this.temporaryOptions = options ?? null;
    this.overrideTool = nextTool;
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

    if (this.activeTool?.renderBelowHandles || this.hasActiveStaticContributors()) {
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

  renderContributors(layer: ToolRenderLayer, context: Omit<ToolRenderContext, "editor">): void {
    const activeToolId = this.activeToolId;
    this.forEachContributor((toolId, contributor) => {
      if (contributor.layer !== layer) return;
      const visibility = contributor.visibility ?? "active-only";
      if (visibility === "active-only" && toolId !== activeToolId) return;
      contributor.render({
        editor: this.editor,
        ...context,
      });
    });
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
    if (this.primaryTool) {
      this.editor.setActiveToolState(this.primaryTool.getState());
    }
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

  private createToolInstance(id: ToolName): ToolInstance | null {
    const manifest = this.registry.get(id);
    if (!manifest) return null;
    return manifest.create(this.editor);
  }

  private hasActiveStaticContributors(): boolean {
    const activeToolId = this.activeToolId;
    if (!activeToolId) return false;

    return this.hasStaticContributors(activeToolId, "active-only");
  }

  private hasAlwaysStaticContributors(): boolean {
    for (const toolId of this.registry.keys()) {
      if (this.hasStaticContributors(toolId, "always")) {
        return true;
      }
    }
    return false;
  }

  private hasStaticContributors(toolId: ToolName, visibility: "always" | "active-only"): boolean {
    const manifest = this.registry.get(toolId);
    if (!manifest?.renderContributors) return false;

    return manifest.renderContributors.some((contributor) => {
      const contributorVisibility = contributor.visibility ?? "active-only";
      return contributorVisibility === visibility && isStaticRenderLayer(contributor.layer);
    });
  }

  private needsStaticRedrawOnActivation(): boolean {
    return (
      !!this.primaryTool?.renderBelowHandles ||
      this.hasActiveStaticContributors() ||
      this.hasAlwaysStaticContributors()
    );
  }

  private forEachContributor(
    visit: (
      toolId: ToolName,
      contributor: NonNullable<ToolManifest["renderContributors"]>[number],
    ) => void,
  ): void {
    for (const [toolId, manifest] of this.registry) {
      const contributors = manifest.renderContributors ?? [];
      for (const contributor of contributors) {
        visit(toolId, contributor);
      }
    }
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
