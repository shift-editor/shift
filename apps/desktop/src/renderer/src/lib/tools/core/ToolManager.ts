import type { Point2D } from "@shift/geo";
import type { Editor } from "@/lib/editor/Editor";
import type { HistoryCapture } from "@/lib/editor/HistoryCapture";
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
import { ToolRegistration } from "./ToolRegistration";
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
  private owners = new Map<ToolName, symbol>();
  private primaryTool: ToolInstance | null = null;
  private overrideTool: ToolInstance | null = null;
  readonly #activeTool: WritableSignal<ToolInstance | null>;
  readonly #manifests: WritableSignal<ReadonlyMap<ToolName, ToolManifest>>;
  private gesture = new GestureDetector();
  private editor: Editor;
  private pendingReplacements = new Set<ToolName>();
  #historyCapture: HistoryCapture | null = null;

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
    this.#manifests = signal<ReadonlyMap<ToolName, ToolManifest>>(new Map(), {
      name: "toolManager.manifests",
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

  get manifests(): ReadonlyMap<ToolName, ToolManifest> {
    return this.#manifests.peek();
  }

  get manifestsCell(): Signal<ReadonlyMap<ToolName, ToolManifest>> {
    return this.#manifests;
  }

  /**
   * Installs one tool contribution and returns its ownership handle.
   *
   * @param manifest - Stable identity, metadata, and factory to install.
   * @returns A handle that can replace or permanently remove this contribution.
   * @throws {Error} when the ID is empty or already owned.
   */
  register(manifest: ToolManifest): ToolRegistration {
    this.#validateManifest(manifest);
    if (this.registry.has(manifest.id)) {
      throw new Error(`[ToolManager] Tool already registered: ${manifest.id}`);
    }

    const owner = Symbol(manifest.id);
    this.registry.set(manifest.id, manifest);
    this.owners.set(manifest.id, owner);
    this.#publishManifests();

    return new ToolRegistration(
      manifest.id,
      (nextManifest) => this.#replaceRegistration(owner, nextManifest),
      () => this.#disposeRegistration(owner, manifest.id),
    );
  }

  activate(id: ToolName): void {
    if (this.editor.isDragging) this.cancelPointerGesture();
    if (this.overrideTool) this.#clearOverride();

    const nextTool = this.createToolInstance(id);
    if (!nextTool) {
      console.warn(`[ToolManager] Unknown tool: ${id}`);
      return;
    }

    this.#disposePrimary();
    this.gesture.reset();
    this.editor.gesture.reset();

    this.primaryTool = nextTool;
    if (this.primaryTool.activate) this.primaryTool.activate();

    this.#publishActiveTool();
  }

  requestTemporary(toolId: ToolName, options?: TemporaryToolOptions): void {
    if (this.overrideTool || this.editor.isDragging) return;

    const nextTool = this.createToolInstance(toolId);
    if (!nextTool) return;

    this.temporaryOptions = options ?? null;
    this.overrideTool = nextTool;
    if (this.overrideTool.activate) this.overrideTool.activate();
    this.#publishActiveTool();
    if (this.temporaryOptions?.onActivate) this.temporaryOptions.onActivate();
  }

  returnFromTemporary(): void {
    if (!this.overrideTool) return;
    if (this.editor.isDragging) this.cancelPointerGesture();

    this.#clearOverride();
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
   * Drains any pending pointer move synchronously.
   *
   * @remarks
   * Pointer moves normally coalesce through `requestAnimationFrame`. Tests and
   * automation use this boundary to complete input, gesture, tool-state, and
   * cursor publication before the next action.
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
    this.flushPointerMoves();

    const coords = this.editor.fromScreen(screenPoint);
    this.editor.input.setModifiers(modifiers);
    this.editor.input.setPointer(coords);
    const events = this.gesture.pointerUp(coords, modifiers);
    this.dispatchEvents(events);
    this.editor.gesture.reset();
    this.#flushPendingReplacements();
  }

  cancelPointerGesture(): void {
    const wasDragging = this.gesture.isDragging;
    this.gesture.reset();
    this.editor.gesture.reset();
    if (wasDragging) {
      this.#dispatchEvent({ type: "dragCancel" });
    }
    this.#flushPendingReplacements();
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
      this.cancelPointerGesture();
      return true;
    }

    return this.#dispatchEvent({
      type: "keyDown",
      key: e.key,
      ...modifiers,
    });
  }

  handleKeyUp(e: KeyboardEvent): boolean {
    const modifiers = normalizeModifiers({
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
    });
    this.editor.input.setModifiers(modifiers);

    return this.#dispatchEvent({
      type: "keyUp",
      key: e.key,
      ...modifiers,
    });
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

  /** Permanently disposes every resident instance and installed contribution. */
  dispose(): void {
    if (this.editor.isDragging) this.cancelPointerGesture();

    this.#disposeOverride();
    this.#disposePrimary();
    this.registry.clear();
    this.owners.clear();
    this.pendingReplacements.clear();
    this.#publishActiveTool();
    this.#publishManifests();
  }

  /** Resets gesture and active-tool state at an editor context boundary. */
  reset(): void {
    if (this.editor.isDragging) {
      this.cancelPointerGesture();
    } else {
      this.gesture.reset();
      this.editor.gesture.reset();
    }

    if (this.overrideTool) this.#clearOverride();

    const primaryToolId = this.primaryToolId;
    if (primaryToolId) this.activate(primaryToolId);
  }

  notifySelectionChanged(): void {
    this.#dispatchEvent({ type: "selectionChanged" });
  }

  private dispatchEvents(events: GestureEvent[]): void {
    for (const event of events) {
      this.#dispatchEvent(this.withPointerTarget(event));
    }
  }

  #dispatchEvent(event: ToolEvent): boolean {
    switch (event.type) {
      case "dragStart": {
        this.#historyCapture?.discard();
        const capture = this.editor.history.beginCapture();
        this.#historyCapture = capture;

        try {
          return this.activeTool?.handleEvent(event) ?? false;
        } catch (error) {
          capture.discard();
          this.#historyCapture = null;
          throw error;
        }
      }

      case "dragEnd": {
        const capture = this.#historyCapture;
        this.#historyCapture = null;

        try {
          const handled = this.activeTool?.handleEvent(event) ?? false;
          capture?.finish();
          return handled;
        } catch (error) {
          capture?.discard();
          throw error;
        }
      }

      case "dragCancel": {
        const capture = this.#historyCapture;
        this.#historyCapture = null;

        try {
          return this.activeTool?.handleEvent(event) ?? false;
        } finally {
          capture?.discard();
        }
      }

      case "drag":
      case "pointerMove":
        return this.activeTool?.handleEvent(event) ?? false;

      case "click":
      case "doubleClick":
      case "keyDown":
      case "keyUp":
      case "selectionChanged": {
        if (this.editor.history.capturing) {
          return this.activeTool?.handleEvent(event) ?? false;
        }

        const capture = this.editor.history.beginCapture();
        try {
          const handled = this.activeTool?.handleEvent(event) ?? false;
          capture.finish();
          return handled;
        } catch (error) {
          capture.discard();
          throw error;
        }
      }
    }
  }

  private withPointerTarget(event: GestureEvent): ToolEvent {
    switch (event.type) {
      case "pointerMove":
      case "click":
      case "doubleClick":
      case "drag":
      case "dragEnd":
        return {
          ...event,
          target: this.editor.getPointerTarget(event.coords.scene),
        };
      case "dragStart":
        return {
          ...event,
          target: this.editor.getPointerTarget(event.origin.scene),
        };
      case "dragCancel":
      case "keyDown":
      case "keyUp":
      case "selectionChanged":
        return event;
    }
  }

  private createToolInstance(id: ToolName): ToolInstance | null {
    const manifest = this.registry.get(id);
    if (!manifest) return null;
    return manifest.create(this.editor);
  }

  #replaceRegistration(owner: symbol, manifest: ToolManifest): void {
    this.#assertOwner(owner, manifest.id);
    this.#validateManifest(manifest);
    this.registry.set(manifest.id, manifest);
    this.#publishManifests();

    if (this.activeTool?.id === manifest.id && this.editor.isDragging) {
      this.pendingReplacements.add(manifest.id);
      return;
    }

    this.#replaceResident(manifest.id);
  }

  #disposeRegistration(owner: symbol, id: ToolName): void {
    this.#assertOwner(owner, id);
    this.pendingReplacements.delete(id);

    const removingActive = this.activeTool?.id === id;
    const removingPrimary = this.primaryTool?.id === id;
    const removingOverride = this.overrideTool?.id === id;

    if (removingActive && this.editor.isDragging) this.cancelPointerGesture();

    this.registry.delete(id);
    this.owners.delete(id);
    this.#publishManifests();

    if (removingOverride) this.#clearOverride();
    if (removingPrimary) this.#disposePrimary();

    if (removingActive) {
      const fallbackId = this.#fallbackId();
      if (fallbackId) {
        this.activate(fallbackId);
      } else {
        this.#publishActiveTool();
      }
      return;
    }

    if (removingPrimary && this.overrideTool) {
      const fallbackId = this.#fallbackId();
      this.primaryTool = fallbackId ? this.createToolInstance(fallbackId) : null;
      if (this.primaryTool?.activate) this.primaryTool.activate();
    }

    this.#publishActiveTool();
  }

  #replaceResident(id: ToolName): void {
    if (this.overrideTool?.id === id) {
      this.#disposeOverride();
      this.overrideTool = this.createToolInstance(id);
      if (this.overrideTool?.activate) this.overrideTool.activate();
      this.#publishActiveTool();
      return;
    }

    if (this.primaryTool?.id !== id) return;

    if (this.primaryTool.deactivate) this.primaryTool.deactivate();
    this.primaryTool.dispose();
    this.primaryTool = this.createToolInstance(id);
    if (this.primaryTool?.activate) this.primaryTool.activate();
    this.#publishActiveTool();
  }

  #flushPendingReplacements(): void {
    if (this.pendingReplacements.size === 0) return;

    const ids = [...this.pendingReplacements];
    this.pendingReplacements.clear();
    for (const id of ids) {
      if (this.registry.has(id)) this.#replaceResident(id);
    }
  }

  #clearOverride(): void {
    this.#disposeOverride();
    if (this.temporaryOptions?.onReturn) this.temporaryOptions.onReturn();
    this.temporaryOptions = null;
    this.#publishActiveTool();
  }

  #disposeOverride(): void {
    if (!this.overrideTool) return;
    if (this.overrideTool.deactivate) this.overrideTool.deactivate();
    this.overrideTool.dispose();
    this.overrideTool = null;
  }

  #disposePrimary(): void {
    if (!this.primaryTool) return;
    if (this.primaryTool.deactivate) this.primaryTool.deactivate();
    this.primaryTool.dispose();
    this.primaryTool = null;
  }

  #fallbackId(): ToolName | null {
    if (this.registry.has("select")) return "select";

    return this.registry.keys().next().value ?? null;
  }

  #assertOwner(owner: symbol, id: ToolName): void {
    if (this.owners.get(id) !== owner) {
      throw new Error(`[ToolManager] Tool registration is no longer current: ${id}`);
    }
  }

  #validateManifest(manifest: ToolManifest): void {
    if (typeof manifest.id !== "string" || manifest.id.trim() === "") {
      throw new Error("[ToolManager] Tool id must be a non-empty string");
    }
  }

  #publishActiveTool(): void {
    this.#activeTool.set(this.overrideTool ?? this.primaryTool);
  }

  #publishManifests(): void {
    this.#manifests.set(new Map(this.registry));
  }
}
