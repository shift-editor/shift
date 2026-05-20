import type { Point2D } from "@shift/geo";
import type { ContourId, Source, SourceId } from "@shift/types";
import type { GlyphHandle } from "@shared/bridge/BridgeApi";
import type { Coordinates } from "@/types/coordinates";
import type { AxisLocation } from "@/types/variation";
import type { DebugOverlays } from "@shared/ipc/types";
import type { Modifiers } from "../tools/core/GestureDetector";
import type { Font } from "../model/Font";
import type { Glyph, GlyphInstance, GlyphSource } from "../model/Glyph";
import type { FocusedGlyph } from "../text/TextRun";
import type { GlyphAnchor } from "../text/layout";
import type { TextRuns } from "../text/TextRuns";
import { emptyAxisLocation } from "../variation/location";
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
  readonly editableGlyphVisible: boolean;
}

export type EditorGesturePhase = "idle" | "pressed" | "dragging";

export interface EditorGestureSnapshot {
  readonly phase: EditorGesturePhase;
}

export class EditorGesture {
  readonly #cell: WritableSignal<EditorGestureSnapshot>;
  readonly cell: Signal<EditorGestureSnapshot>;

  constructor() {
    this.#cell = signal<EditorGestureSnapshot>(
      { phase: "idle" },
      { name: "editor.gesture" },
    );
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
          editableGlyphVisible:
            !hasTextActivity || focusedGlyph?.anchor.runId === run.id,
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

/**
 * Stores the current designspace coordinate.
 *
 * The location drives preview geometry and display outlines. Source selection
 * policy is applied by `Editor.setDesignLocation`.
 */
export class DesignLocationState {
  /** Reactive designspace location used by preview geometry and outlines. */
  readonly location: WritableSignal<AxisLocation>;

  constructor() {
    this.location = signal<AxisLocation>(emptyAxisLocation(), {
      name: "editor.glyph.design.location",
    });
  }

  /**
   * Set the raw designspace coordinate.
   *
   * This updates `location` only. Use `Editor.setDesignLocation` when the edit
   * source should be synchronized with the new coordinate.
   */
  set(location: AxisLocation): void {
    this.location.set(location);
  }
}

/**
 * Resolves the authored glyph source selected for editing.
 *
 * `sourceId === null` means the edit target follows the exact source at the
 * current design location when one exists.
 */
export class EditTargetState {
  /** Explicit authored source selected for editing, or `null` for location fallback. */
  readonly sourceId: WritableSignal<SourceId | null>;

  /** Authored font source selected by `sourceId` or by exact design-location fallback. */
  readonly source: Signal<Source | null>;

  /** Editable glyph data for the selected authored source. */
  readonly glyphSource: Signal<GlyphSource | null>;

  constructor(font: Font, open: OpenGlyphState, design: DesignLocationState) {
    this.sourceId = signal<SourceId | null>(null, {
      name: "editor.glyph.edit.sourceId",
    });

    this.source = computed(
      () => {
        const sourceId = this.sourceId.value;
        if (sourceId) return font.source(sourceId);

        return font.sourceAt(design.location.value);
      },
      { name: "editor.glyph.edit.source" },
    );

    this.glyphSource = computed(
      () => {
        const glyph = open.glyph.value;
        if (!glyph) return null;

        const source = this.source.value;
        if (!source) return null;

        return font.glyphSource(glyph.handle, source);
      },
      { name: "editor.glyph.edit.glyphSource" },
    );
  }

  /**
   * Select an explicit authored source as the edit target.
   *
   * Resolution is reactive: `source` and `glyphSource` update after this ID is
   * set, and either may be `null` if the source or open glyph is unavailable.
   */
  selectSource(sourceId: SourceId): void {
    this.sourceId.set(sourceId);
  }

  /**
   * Clear explicit source selection.
   *
   * After this call, `source` resolves from the exact source at the current
   * design location, and `glyphSource` follows that source when a glyph is open.
   */
  selectDefaultSource(): void {
    this.sourceId.set(null);
  }
}

/**
 * Provides read models for the displayed glyph at the current design location.
 *
 * The instance is the glyph resolved at the current design location. Query,
 * render, and edit callers choose a surface from that one instance instead of
 * choosing between source geometry, interpolated geometry, and outline models.
 */
export class PreviewGlyphState {
  /** Glyph resolved at the current design location. */
  readonly instance: Signal<GlyphInstance | null>;

  constructor(open: OpenGlyphState, design: DesignLocationState) {
    this.instance = computed(
      () => {
        const glyph = open.glyph.value;
        if (!glyph) return null;

        return glyph.instance(design.location);
      },
      { name: "editor.glyph.preview.instance" },
    );
  }
}
/**
 * Groups glyph-session state by ownership.
 *
 * `edit` owns authored source selection. `preview` owns the displayed glyph
 * model at the current design location.
 */
export class EditorGlyphState {
  readonly open: OpenGlyphState;
  readonly design: DesignLocationState;
  readonly edit: EditTargetState;
  readonly preview: PreviewGlyphState;

  constructor(font: Font) {
    this.open = new OpenGlyphState();
    this.design = new DesignLocationState();
    this.edit = new EditTargetState(font, this.open, this.design);
    this.preview = new PreviewGlyphState(this.open, this.design);
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
