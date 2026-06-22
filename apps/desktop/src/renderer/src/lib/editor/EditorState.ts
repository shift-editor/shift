import type { Point2D } from "@shift/geo";
import type { ContourId, LayerId, Source, SourceId } from "@shift/types";
import type { Coordinates } from "@/types/coordinates";
import type { AxisLocation } from "@/types/variation";
import type { DebugOverlays } from "@/types/uiState";
import type { Modifiers } from "../tools/core/GestureDetector";
import type { Font } from "../model/Font";
import type { Glyph, GlyphInstance, GlyphLayer } from "../model/Glyph";
import type { Scene } from "./Scene";
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

/** Active glyph state derived from placed scene items. */
export class ActiveGlyphState {
  /** Glyph model for the first geometry-shown glyph item, or first placed glyph. */
  readonly glyph: Signal<Glyph | null>;

  /** Contour receiving appended pen points, or `null` when no contour is active. */
  readonly activeContourId: WritableSignal<ContourId | null>;

  constructor(font: Font, scene: Scene) {
    this.glyph = computed(
      () => {
        const value = scene.cell.value;
        font.glyphRecordsCell.value;
        font.glyphSnapshotStatusCell.value;
        const geometryItem = value.geometryItems
          .map((itemId) => value.items.find((item) => item.id === itemId) ?? null)
          .find((item) => item?.kind === "glyph");
        const fallbackItem = value.items.find((item) => item.kind === "glyph") ?? null;
        const item = geometryItem ?? fallbackItem;
        return item?.kind === "glyph" ? font.glyphForId(item.glyphId) : null;
      },
      { name: "editor.glyph.active" },
    );
    this.activeContourId = signal<ContourId | null>(null, {
      name: "editor.glyph.activeContourId",
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
 * The editable source follows the exact source at the current design location
 * when one exists.
 */
export class GlyphLayerEditingState {
  /** ID for the exact designspace source selected by the current design location. */
  readonly sourceId: Signal<SourceId | null>;

  /** Exact font source selected by the current design location. */
  readonly selectedSource: Signal<Source | null>;

  /** Selected source with the current glyph's authored layer when one exists. */
  readonly layer: Signal<GlyphLayerResolution | null>;

  /** Authored glyph layer data for the selected source. */
  readonly glyphLayer: Signal<GlyphLayer | null>;

  constructor(font: Font, glyph: Signal<Glyph | null>, location: Signal<AxisLocation>) {
    this.selectedSource = computed(
      () => {
        return font.sourceAt(location.value);
      },
      { name: "editor.glyph.layerEditing.source" },
    );
    this.sourceId = computed(() => this.selectedSource.value?.id ?? null, {
      name: "editor.glyph.layerEditing.sourceId",
    });

    this.layer = computed(
      () => {
        const source = this.selectedSource.value;
        if (!source) return null;

        const activeGlyph = glyph.value;
        if (!activeGlyph) return { sourceId: source.id, layerId: null };

        const layerId = font.layerRecordForId(activeGlyph.id, source.id)?.id ?? null;
        return { sourceId: source.id, layerId };
      },
      { name: "editor.glyph.layerEditing.layer" },
    );

    this.glyphLayer = computed(
      () => {
        const activeGlyph = glyph.value;
        if (!activeGlyph) return null;

        const source = this.selectedSource.value;
        if (!source) return null;
        if (this.layer.value?.layerId === null) return null;

        return font.glyphLayerForId(activeGlyph.id, source.id);
      },
      { name: "editor.glyph.layerEditing.glyphLayer" },
    );
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

  constructor(glyph: Signal<Glyph | null>, location: Signal<AxisLocation>) {
    this.instance = computed(
      () => {
        const activeGlyph = glyph.value;
        if (!activeGlyph) return null;

        return activeGlyph.instance(location);
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
  readonly active: ActiveGlyphState;
  readonly layerEditing: GlyphLayerEditingState;
  readonly preview: PreviewGlyphState;

  constructor(font: Font, scene: Scene, location: Signal<AxisLocation>) {
    this.active = new ActiveGlyphState(font, scene);
    this.layerEditing = new GlyphLayerEditingState(font, this.active.glyph, location);
    this.preview = new PreviewGlyphState(this.active.glyph, location);
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
