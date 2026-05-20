import type { Point2D } from "@shift/geo";
import type { DebugOverlays as DebugOverlayState } from "@shared/ipc/types";
import type { Glyph, GlyphInstance } from "@/lib/model/Glyph";
import type { FocusedGlyph, TextRun } from "@/lib/text/TextRun";
import type { SelectionState } from "@/lib/editor/Selection";
import type { HoverState } from "@/lib/editor/Hover";
import type { Editor } from "@/lib/editor/Editor";
import type { GlyphDisplayState } from "@/lib/editor/EditorState";
import type { AxisLocation } from "@/types/variation";
import { track, type Signal } from "@/lib/signals";
import { displayAdvance } from "@/lib/utils/unicode";
import { SCREEN_HIT_RADIUS } from "./constants";
import { CanvasItem } from "./CanvasItem";
import type { Canvas } from "./Canvas";
import { OutlineRenderer } from "./Outline";
import { Text as TextRunDrawer } from "./Text";
import {
  Anchors,
  ControlLines,
  DebugOverlays,
  Guides,
  Handles,
} from "./overlays";
import type { MarkerLayer } from "@/lib/graphics/backends/MarkerLayer";

export interface BackgroundLayerProps {
  readonly glyph: {
    readonly model: Glyph;
    readonly display: GlyphDisplayState;
    readonly advance: number;
  };
}

interface SceneGlyphProps {
  readonly model: Glyph | null;
  readonly instance: GlyphInstance | null;
  readonly display: GlyphDisplayState;
}

interface SceneInteractionProps {
  readonly selection: SelectionState;
  readonly hover: HoverState;
}

interface SceneViewProps {
  readonly debugOverlays: DebugOverlayState;
  readonly drawOffset: Point2D;
}

export interface SceneLayerProps {
  readonly glyph: SceneGlyphProps;
  readonly interaction: SceneInteractionProps;
  readonly view: SceneViewProps;
}

interface TextLayerProps {
  readonly run: TextRun;
  readonly designLocation: Signal<AxisLocation>;
  readonly drawOffset: Point2D;
  readonly focusedGlyph: FocusedGlyph | null;
}

export interface OverlayLayerProps {
  readonly activeTool: string;
  readonly activeToolState: unknown;
}

/**
 * Draws stable glyph-context content behind the editable scene.
 *
 * @remarks
 * Z-order slot 0. This layer sits below the editable glyph scene and should
 * contain stable context such as metrics guides and tool-specific background
 * aids.
 *
 * The layer owns the reactive dependency boundary for guides and tool
 * background drawing. `props()` reads editor state; `draw()` consumes the
 * resulting plain data plus the active tool background hook.
 */
export class BackgroundLayer extends CanvasItem<BackgroundLayerProps> {
  readonly #editor: Editor;
  readonly #guides = new Guides();

  /**
   * Creates the background layer for one editor.
   *
   * @param editor - Editor session whose camera, glyph, and active tool are rendered.
   */
  constructor(editor: Editor) {
    super();
    this.#editor = editor;
  }

  protected props(): BackgroundLayerProps | null {
    this.#editor.camera.trackViewportTransform();
    this.#editor.activeToolCell.value;
    this.#editor.activeToolStateCell.value;
    this.#editor.$drawOffset.value;

    const glyph = this.#editor.glyph.value;
    if (!glyph) return null;

    const display = this.#editor.glyphDisplayCell.value;
    if (!display.editableGlyphVisible && display.proofMode) return null;

    const unicode = Number.isFinite(glyph.unicode) ? glyph.unicode : null;
    const advance = displayAdvance(glyph.xAdvance, glyph.name, unicode);

    return { glyph: { model: glyph, display, advance } };
  }

  draw(canvas: Canvas): void {
    const props = this.propsCell.value;
    if (!props) return;

    this.#guides.draw(canvas, this.#editor.font.metrics, props.glyph.advance);
    this.#editor.toolManager.drawBackground(canvas);
  }
}

/**
 * Draws the active text run in scene space.
 *
 * @remarks
 * Text layout, caret, selection rectangles, hover, and active run selection
 * are text-owned dependencies. Keeping them here makes text rendering wake the
 * scene without hiding text-specific subscriptions in the broader glyph scene
 * layer.
 */
export class TextLayer extends CanvasItem<TextLayerProps> {
  readonly #editor: Editor;
  readonly #textRuns = new TextRunDrawer();

  /**
   * Creates the text layer for one editor.
   *
   * @param editor - Editor session whose active text run is rendered.
   */
  constructor(editor: Editor) {
    super();
    this.#editor = editor;
  }

  protected props(): TextLayerProps {
    const run = this.#editor.textRuns.activeCell.value;

    track(run.layoutCell);
    track(run.selectionRectsCell);
    track(run.cursorVisibleCell);
    track(run.caretCell);
    track(run.interaction.hoveredIndexCell);

    return {
      run,
      designLocation: this.#editor.$designLocation,
      drawOffset: this.#editor.$drawOffset.value,
      focusedGlyph: this.#editor.focusedGlyphCell.value,
    };
  }

  draw(canvas: Canvas): void {
    const props = this.propsCell.value;
    if (!props) return;

    this.#textRuns.draw(
      canvas,
      props.run,
      this.#editor.font,
      props.designLocation,
      props.drawOffset,
      props.focusedGlyph,
    );
  }
}

/**
 * Draws the main editable glyph scene.
 *
 * @remarks
 * Z-order slot 1. This layer is ordered from persistent glyph content to
 * direct edit affordances:
 *
 * 1. editable glyph outline
 * 2. debug overlays
 * 3. active tool scene drawing
 * 4. text runs
 * 5. glyph handles, anchors, and control lines
 *
 * Tool visuals that should appear below point handles, such as a pen preview
 * line, belong in the active tool scene hook. Tool visuals that must appear
 * above handles belong in the overlay layer.
 *
 * Scene props group glyph display state, interaction state, and view state so
 * render dependencies stay inspectable. Control lines are drawn as part of the
 * handle pass because handles and their control tethers are one visual affordance.
 */
export class SceneLayer extends CanvasItem<SceneLayerProps> {
  readonly #editor: Editor;
  readonly #outline = new OutlineRenderer();
  readonly #debugOverlays = new DebugOverlays();
  readonly #controlLines = new ControlLines();
  readonly #anchors = new Anchors();
  readonly #handles: Handles;
  readonly #textLayer: TextLayer;

  /**
   * Creates the scene layer for one editor.
   *
   * @param editor - Editor session whose preview glyph, selection, hover, and text runs are rendered.
   */
  constructor(editor: Editor) {
    super();
    this.#editor = editor;
    this.#handles = new Handles(editor);
    this.#textLayer = new TextLayer(editor);
  }

  /** Attach the marker layer used by accelerated handle drawing. */
  setMarkerLayer(layer: MarkerLayer | null): void {
    this.#handles.setMarkerLayer(layer);
  }

  protected props(): SceneLayerProps {
    this.#editor.camera.trackViewportTransform();
    this.#editor.activeToolCell.value;
    this.#editor.activeToolStateCell.value;

    const instance = this.#editor.previewInstanceCell.value;
    if (instance) instance.render.trackShape();

    return {
      glyph: {
        model: this.#editor.glyph.value,
        instance,
        display: this.#editor.glyphDisplayCell.value,
      },
      interaction: {
        selection: this.#editor.selection.stateCell.value,
        hover: this.#editor.hover.targetCell.value,
      },
      view: {
        debugOverlays: this.#editor.debugOverlaysCell.value,
        drawOffset: this.#editor.$drawOffset.value,
      },
    };
  }

  draw(canvas: Canvas): void {
    const props = this.propsCell.value;
    if (!props) return;

    // Scene z-order. Keep this sequence intentional; see the class remarks.
    this.#drawGlyphOutline(canvas, props);
    this.#drawDebugOverlays(canvas, props);
    this.#editor.toolManager.drawScene(canvas);
    this.#drawTextRuns(canvas);
    this.#drawGlyphEditHandles(canvas, props);
  }

  #drawGlyphOutline(canvas: Canvas, props: SceneLayerProps): void {
    const { model, instance, display } = props.glyph;
    if (!model || !instance || !display.editableGlyphVisible) return;

    this.#outline.draw(canvas, instance.render.outline, {
      fill: display.proofMode ? canvas.theme.glyph.fill : null,
      stroke: {
        color: canvas.theme.glyph.stroke,
        widthPx: canvas.theme.glyph.widthPx,
      },
    });
  }

  #drawDebugOverlays(canvas: Canvas, props: SceneLayerProps): void {
    const { model, display } = props.glyph;
    if (!model || display.proofMode || !display.editableGlyphVisible) return;
    const { hover } = props.interaction;
    const hoveredSegmentId = hover?.type === "segment" ? hover.segmentId : null;

    this.#debugOverlays.draw(
      canvas,
      model,
      props.view.debugOverlays,
      hoveredSegmentId,
      canvas.pxToUpm(SCREEN_HIT_RADIUS),
    );
  }

  #drawTextRuns(canvas: Canvas): void {
    this.#textLayer.draw(canvas);
  }

  #drawGlyphEditHandles(canvas: Canvas, props: SceneLayerProps): void {
    const { instance, display } = props.glyph;
    if (
      display.proofMode ||
      !display.handlesVisible ||
      !display.editableGlyphVisible ||
      !instance
    ) {
      this.#handles.clear();
      return;
    }

    const renderModel = instance.render;
    const sceneBounds = this.#editor.camera.visibleSceneBounds(64);
    const drawOffset = props.view.drawOffset;

    this.#controlLines.draw(canvas, renderModel.contours, (from, to) => {
      const minX = Math.min(from.x, to.x) + drawOffset.x;
      const maxX = Math.max(from.x, to.x) + drawOffset.x;
      const minY = Math.min(from.y, to.y) + drawOffset.y;
      const maxY = Math.max(from.y, to.y) + drawOffset.y;
      return !(
        maxX < sceneBounds.minX ||
        minX > sceneBounds.maxX ||
        maxY < sceneBounds.minY ||
        minY > sceneBounds.maxY
      );
    });

    this.#handles.draw(canvas, canvas.camera, drawOffset);

    this.#anchors.draw(canvas, renderModel.anchors, {
      selection: props.interaction.selection,
      hover: props.interaction.hover,
    });
  }
}

/**
 * Draws interaction overlays above the glyph scene.
 *
 * @remarks
 * Z-order slot 2. This layer sits above glyph handles and should be reserved
 * for transient interaction chrome that must win visually, such as marquees,
 * drag previews, cursor markers, and modal tool overlays.
 *
 * Overlay props track transient interaction state such as pointer, selection,
 * hover, active tool, and glyph display mode. The renderer supplies a canvas
 * whose context is already in glyph-local UPM coordinates for the current frame.
 */
export class OverlayLayer extends CanvasItem<OverlayLayerProps> {
  readonly #editor: Editor;

  /**
   * Creates the overlay layer for one editor.
   *
   * @param editor - Editor session whose active tool overlay is rendered.
   */
  constructor(editor: Editor) {
    super();
    this.#editor = editor;
  }

  protected props(): OverlayLayerProps {
    this.#editor.camera.trackViewportTransform();
    this.#editor.$drawOffset.value;

    return {
      activeTool: this.#editor.activeToolCell.value,
      activeToolState: this.#editor.activeToolStateCell.value,
    };
  }

  draw(canvas: Canvas): void {
    const props = this.propsCell.value;
    if (!props) return;

    this.#editor.toolManager.drawOverlay(canvas);
  }
}
