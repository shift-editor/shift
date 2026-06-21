import type { Point2D } from "@shift/geo";
import type { ContourId, LayerId, Source, SourceId } from "@shift/types";
import type { GlyphHandle } from "@shared/bridge/BridgeApi";
import type { Coordinates } from "@/types/coordinates";
import type { AxisLocation } from "@/types/variation";
import type { DebugOverlays } from "@/types/uiState";
import type { Modifiers } from "../tools/core/GestureDetector";
import type { Font } from "../model/Font";
import type { Glyph, GlyphInstance, GlyphLayer } from "../model/Glyph";
import type { FocusedGlyph } from "../text/TextRun";
import type { GlyphAnchor } from "../text/layout";
import type { TextRuns } from "../text/TextRuns";
import {
  computed,
  signal,
  type ComputedSignal,
  type Signal,
  type WritableSignal,
} from "../signals";

const DEFAULT_MODIFIERS: Modifiers = {
  shiftKey: false,
  altKey: false,
  metaKey: false,
};

const DEFAULT_DEBUG_OVERLAYS: DebugOverlays = {
  tightBounds: false,
  hitRadii: false,
  segmentBounds: false,
  glyphBbox: false,
};

export interface GlyphDisplayState {
  readonly proofMode: boolean;
  readonly handlesVisible: boolean;
  readonly focusedGlyphVisible: boolean;
}

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

export class GlyphDisplay {
  readonly proofModeCell: WritableSignal<boolean>;
  readonly handlesVisibleCell: WritableSignal<boolean>;
  readonly cell: ComputedSignal<GlyphDisplayState>;

  constructor(text: TextEditingState, textRuns: TextRuns) {
    this.proofModeCell = signal(false, {
      name: "editor.glyph.display.proofMode",
    });
    this.handlesVisibleCell = signal(true, {
      name: "editor.glyph.display.handlesVisible",
    });
    this.cell = computed(
      () => {
        const run = textRuns.activeCell.value;
        const focusedGlyph = text.focusedGlyph.value;
        const hasTextActivity =
          run.buffer.itemsCell.value.length > 0 || run.cursorVisibleCell.value;

        return {
          proofMode: this.proofModeCell.value,
          handlesVisible: this.handlesVisibleCell.value,
          focusedGlyphVisible: !hasTextActivity || focusedGlyph?.anchor.runId === run.id,
        };
      },
      { name: "editor.glyph.display" },
    );
  }

  get value(): GlyphDisplayState {
    return this.cell.peek();
  }

  get proofMode(): boolean {
    return this.proofModeCell.peek();
  }

  setProofMode(enabled: boolean): void {
    this.proofModeCell.set(enabled);
  }

  get handlesVisible(): boolean {
    return this.handlesVisibleCell.peek();
  }

  setHandlesVisible(visible: boolean): void {
    this.handlesVisibleCell.set(visible);
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

/**
 * Stores the glyph focus for the editor session.
 *
 * `glyph` is the loaded model shown by the editor, `rootHandle` is the
 * top-level glyph opened by the route or text-run focus, and `activeContourId`
 * is pen-tool continuation state.
 */
export class OpenGlyphState {
  /** Loaded glyph model for the current editor focus, or `null` when nothing is open. */
  readonly glyph: WritableSignal<Glyph | null>;

  /** Top-level glyph handle selected by the editor route/text run. */
  readonly rootHandle: WritableSignal<GlyphHandle | null>;

  /** Contour receiving appended pen points, or `null` when no contour is active. */
  readonly activeContourId: WritableSignal<ContourId | null>;

  constructor() {
    this.glyph = signal<Glyph | null>(null, {
      name: "editor.glyph.open.glyph",
    });
    this.rootHandle = signal<GlyphHandle | null>(null, {
      name: "editor.glyph.open.rootHandle",
    });
    this.activeContourId = signal<ContourId | null>(null, {
      name: "editor.glyph.open.activeContourId",
    });
  }
}

export interface GlyphLayerResolution {
  readonly sourceId: SourceId;
  readonly layerId: LayerId | null;
}

/**
 * Resolves the authored glyph layer for the current designspace source.
 *
 * `selectedSourceId === null` means the source follows the exact source at the
 * current design location when one exists.
 */
export class GlyphLayerEditingState {
  /** Explicit designspace source selected for layer editing, or `null` for location fallback. */
  readonly selectedSourceId: WritableSignal<SourceId | null>;

  /** Font source selected for layer editing, or by exact design-location fallback. */
  readonly selectedSource: Signal<Source | null>;

  /** Selected source with the current glyph's authored layer when one exists. */
  readonly layer: Signal<GlyphLayerResolution | null>;

  /** Authored glyph layer data for the selected source. */
  readonly glyphLayer: Signal<GlyphLayer | null>;

  constructor(font: Font, open: OpenGlyphState, location: Signal<AxisLocation>) {
    this.selectedSourceId = signal<SourceId | null>(null, {
      name: "editor.glyph.layerEditing.sourceId",
    });

    this.selectedSource = computed(
      () => {
        const sourceId = this.selectedSourceId.value;
        if (sourceId) return font.source(sourceId);

        return font.sourceAt(location.value);
      },
      { name: "editor.glyph.layerEditing.source" },
    );

    this.layer = computed(
      () => {
        const source = this.selectedSource.value;
        if (!source) return null;

        const glyph = open.glyph.value;
        if (!glyph) return { sourceId: source.id, layerId: null };

        const record = font.recordForName(glyph.handle.name);
        const layerId = record ? (font.glyphLayerRecord(record.id, source.id)?.id ?? null) : null;
        return { sourceId: source.id, layerId };
      },
      { name: "editor.glyph.layerEditing.layer" },
    );

    this.glyphLayer = computed(
      () => {
        const glyph = open.glyph.value;
        if (!glyph) return null;

        const source = this.selectedSource.value;
        if (!source) return null;
        if (this.layer.value?.layerId === null) return null;

        return font.glyphLayer(glyph.handle, source);
      },
      { name: "editor.glyph.layerEditing.glyphLayer" },
    );
  }

  /**
   * Select an explicit designspace source for layer editing.
   *
   * Resolution is reactive: `source` and `glyphLayer` update after this id is
   * set, and either may be `null` if the source or open glyph is unavailable.
   */
  selectLayerSource(sourceId: SourceId): void {
    this.selectedSourceId.set(sourceId);
  }

  /**
   * Clear explicit source selection.
   *
   * After this call, `source` resolves from the exact source at the current
   * design location, and `glyphLayer` follows that source when a glyph is open.
   */
  followDesignLocation(): void {
    this.selectedSourceId.set(null);
  }
}

/**
 * Provides read models for the displayed glyph at the current design location.
 *
 * The instance is the glyph resolved at the current design location. Query,
 * render, and edit callers choose a surface from that one instance instead of
 * choosing between layer geometry, interpolated geometry, and outline models.
 */
export class PreviewGlyphState {
  /** Glyph resolved at the current design location. */
  readonly instance: Signal<GlyphInstance | null>;

  constructor(open: OpenGlyphState, location: Signal<AxisLocation>) {
    this.instance = computed(
      () => {
        const glyph = open.glyph.value;
        if (!glyph) return null;

        return glyph.instance(location);
      },
      { name: "editor.glyph.preview.instance" },
    );
  }
}
/**
 * Groups glyph-session state by ownership.
 *
 * `layerEditing` owns authored glyph layer selection. `preview` owns the
 * displayed glyph model at the current design location.
 */
export class EditorGlyphState {
  readonly open: OpenGlyphState;
  readonly layerEditing: GlyphLayerEditingState;
  readonly preview: PreviewGlyphState;

  constructor(font: Font, location: Signal<AxisLocation>) {
    this.open = new OpenGlyphState();
    this.layerEditing = new GlyphLayerEditingState(font, this.open, location);
    this.preview = new PreviewGlyphState(this.open, location);
  }
}

export interface GlyphPlacement {
  focused: FocusedGlyph;
  drawOffset: Point2D;
}

export class TextEditingState {
  readonly glyphAnchor: WritableSignal<GlyphAnchor | null>;
  readonly focusedGlyph: ComputedSignal<FocusedGlyph | null>;
  readonly glyphPlacement: ComputedSignal<GlyphPlacement | null>;
  readonly drawOffset: ComputedSignal<Point2D>;

  constructor(textRuns: TextRuns) {
    this.glyphAnchor = signal<GlyphAnchor | null>(null);

    this.focusedGlyph = computed<FocusedGlyph | null>(() => {
      const anchor = this.glyphAnchor.value;
      if (!anchor) return null;
      return textRuns.resolveAnchor(anchor);
    });

    this.glyphPlacement = computed<GlyphPlacement | null>(() => {
      const focused = this.focusedGlyph.value;
      if (!focused) return null;
      return { focused, drawOffset: focused.editOrigin };
    });

    this.drawOffset = computed<Point2D>(
      () => this.glyphPlacement.value?.drawOffset ?? { x: 0, y: 0 },
    );
  }
}
