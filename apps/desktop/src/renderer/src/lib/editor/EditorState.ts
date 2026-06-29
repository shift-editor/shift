import type { Coordinates } from "@/types/coordinates";
import type { DebugOverlays } from "@/types/uiState";
import type { Modifiers } from "../tools/core/GestureDetector";
import { signal, type Signal, type WritableSignal } from "../signals";

const DEFAULT_MODIFIERS: Modifiers = {
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  accelKey: false,
};

const DEFAULT_DEBUG_OVERLAYS: DebugOverlays = {
  tightBounds: false,
  hitRadii: false,
  segmentBounds: false,
  glyphBbox: false,
};

export type EditorGesturePhase = "idle" | "pressed" | "dragging";

export interface EditorGestureSnapshot {
  readonly phase: EditorGesturePhase;
}

export class EditorGesture {
  readonly #cell: WritableSignal<EditorGestureSnapshot>;
  readonly cell: Signal<EditorGestureSnapshot>;

  constructor() {
    this.#cell = signal<EditorGestureSnapshot>({ phase: "idle" }, { name: "editor.gesture" });
    this.cell = this.#cell;
  }

  get state(): EditorGestureSnapshot {
    return this.#cell.peek();
  }

  get phase(): EditorGesturePhase {
    return this.state.phase;
  }

  get isDragging(): boolean {
    return this.phase === "dragging";
  }

  setPressed(): void {
    this.#setPhase("pressed");
  }

  setDragging(): void {
    this.#setPhase("dragging");
  }

  reset(): void {
    this.#setPhase("idle");
  }

  #setPhase(phase: EditorGesturePhase): void {
    if (this.phase === phase) return;
    this.#cell.set({ phase });
  }
}

export class EditorInput {
  readonly #pointer: WritableSignal<Coordinates | null>;
  readonly #modifiers: WritableSignal<Modifiers>;
  readonly pointerCell: Signal<Coordinates | null>;
  readonly modifiersCell: Signal<Modifiers>;

  constructor() {
    this.#pointer = signal<Coordinates | null>(null, {
      name: "editor.input.pointer",
    });
    this.#modifiers = signal<Modifiers>(DEFAULT_MODIFIERS, {
      name: "editor.input.modifiers",
    });
    this.pointerCell = this.#pointer;
    this.modifiersCell = this.#modifiers;
  }

  get pointer(): Coordinates | null {
    return this.#pointer.peek();
  }

  get modifiers(): Modifiers {
    return this.#modifiers.peek();
  }

  setPointer(pointer: Coordinates): void {
    this.#pointer.set(pointer);
  }

  clearPointer(): void {
    this.#pointer.set(null);
  }

  setModifiers(modifiers: Modifiers): void {
    this.#modifiers.set(modifiers);
  }
}

export class EditorViewState {
  readonly debugOverlaysCell: WritableSignal<DebugOverlays>;
  readonly cursorCell: WritableSignal<string>;

  constructor() {
    this.debugOverlaysCell = signal<DebugOverlays>(DEFAULT_DEBUG_OVERLAYS, {
      name: "editor.view.debugOverlays",
    });
    this.cursorCell = signal("default", { name: "editor.view.cursor" });
  }
}
