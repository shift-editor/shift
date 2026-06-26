import type { Point2D } from "@shift/geo";
import type { DebugOverlays as DebugOverlayState } from "@/types/uiState";
import type { Glyph, GlyphInstance } from "@/lib/model/Glyph";
import type { FocusedGlyph, TextRun } from "@/lib/text/TextRun";
import type { SelectionState } from "@/lib/editor/Selection";
import type { HoverState } from "@/lib/editor/Hover";
import type { Editor } from "@/lib/editor/Editor";
import type { GlyphDisplayState } from "@/lib/editor/EditorState";
import type { SceneGlyph } from "@/lib/editor/Scene";
import type { AxisLocation } from "@/types/variation";
import type { GlyphRecord, Unicode } from "@shift/types";
import { track, type Signal } from "@/lib/signals";
import { displayAdvance } from "@/lib/utils/unicode";
import { SCREEN_HIT_RADIUS } from "./constants";
import { CanvasItem } from "./CanvasItem";
import type { Canvas } from "./Canvas";
import { OutlineRenderer } from "./Outline";
import { Text as TextRunDrawer } from "./Text";
import { Anchors, ControlLines, DebugOverlays, Guides, Handles } from "./overlays";
import type { MarkerLayer } from "@/lib/graphics/backends/MarkerLayer";

interface BackgroundGlyphFrame {
  readonly item: SceneGlyph;
  readonly advance: number;
  readonly geometryShown: boolean;
}

interface GuideAdvanceInput {
  readonly record: GlyphRecord;
  readonly model: Glyph | null;
  readonly xAdvance: number;
}

export interface BackgroundLayerProps {
  readonly glyphs: readonly BackgroundGlyphFrame[];
}

interface SceneGlyphFrame {
  readonly item: SceneGlyph;
  readonly model: Glyph | null;
  readonly instance: GlyphInstance | null;
  readonly geometryShown: boolean;
}

interface SceneInteractionProps {
  readonly selection: SelectionState;
  readonly hover: HoverState;
}

interface SceneViewProps {
  readonly debugOverlays: DebugOverlayState;
}

export interface SceneLayerProps {
  readonly glyphs: readonly SceneGlyphFrame[];
  readonly display: GlyphDisplayState;
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
 * Draws stable glyph-context content behind the scene.
 *
 * @remarks
 * Z-order slot 0. This layer sits below the scene and should
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

    const scene = this.#editor.scene.cell.value;
    const glyphs: BackgroundGlyphFrame[] = [];

    for (const item of scene.items) {
      if (item.kind !== "glyph") continue;
      const geometryShown = scene.geometryItems.includes(item.id);
      if (!geometryShown) continue;

      const record = this.#editor.font.recordForId(item.glyphId);
      if (!record) continue;

      const glyph = this.#editor.glyphForItem(item.id);
      const instance = this.#editor.instanceForItem(item.id);
      glyphs.push({
        item,
        advance: guideAdvance({
          record,
          model: glyph,
          xAdvance: instance?.xAdvanceCell.value ?? this.#editor.font.defaultXAdvance,
        }),
        geometryShown,
      });
    }

    return { glyphs };
  }

  draw(canvas: Canvas): void {
    const props = this.propsCell.value;
    if (!props) return;

    for (const glyph of props.glyphs) {
      if (!glyph.geometryShown) continue;
      canvas.withTranslation(glyph.item.placement.origin, () => {
        this.#guides.draw(canvas, this.#editor.font.metrics, glyph.advance);
        this.#editor.toolManager.drawBackground(canvas);
      });
    }
  }
}

function guideAdvance(input: GuideAdvanceInput): number {
  return displayAdvance(
    input.xAdvance,
    input.record.name,
    primaryUnicode(input.model, input.record),
  );
}

function primaryUnicode(glyph: Glyph | null, record: GlyphRecord): Unicode | null {
  const unicode = glyph?.unicode;
  if (unicode !== null && unicode !== undefined && Number.isFinite(unicode)) return unicode;

  return record.unicodes[0] ?? null;
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
      drawOffset: { x: 0, y: 0 },
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
 * Draws the main scene.
 *
 * @remarks
 * Z-order slot 1. This layer is ordered from persistent glyph content to
 * direct geometry controls:
 *
 * 1. glyph outlines
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
 * handle pass because handles and their control tethers are one visual unit.
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
    this.#handles = new Handles();
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

    const scene = this.#editor.scene.cell.value;
    const glyphs: SceneGlyphFrame[] = [];
    for (const item of scene.items) {
      if (item.kind !== "glyph") continue;

      const instance = this.#editor.instanceForItem(item.id);
      if (instance) instance.render.trackShape();

      glyphs.push({
        item,
        model: this.#editor.glyphForItem(item.id),
        instance,
        geometryShown: scene.geometryItems.includes(item.id),
      });
    }

    return {
      glyphs,
      display: this.#editor.glyphDisplayCell.value,
      interaction: {
        selection: this.#editor.selection.stateCell.value,
        hover: this.#editor.hover.targetCell.value,
      },
      view: {
        debugOverlays: this.#editor.debugOverlaysCell.value,
      },
    };
  }

  draw(canvas: Canvas): void {
    const props = this.propsCell.value;
    if (!props) return;

    for (const glyph of props.glyphs) {
      this.#drawGlyphOutline(canvas, props, glyph);
      this.#drawDebugOverlays(canvas, props, glyph);
      if (glyph.geometryShown) {
        canvas.withTranslation(glyph.item.placement.origin, () => {
          this.#editor.toolManager.drawScene(canvas);
        });
      }
    }
    this.#drawTextRuns(canvas);
    let drewHandles = false;
    for (const glyph of props.glyphs) {
      drewHandles = this.#drawGlyphEditHandles(canvas, props, glyph) || drewHandles;
    }
    if (!drewHandles) this.#handles.clear();
  }

  #drawGlyphOutline(canvas: Canvas, props: SceneLayerProps, glyph: SceneGlyphFrame): void {
    const { model, instance, geometryShown } = glyph;
    const { display } = props;
    if (!model || !instance) return;
    if (geometryShown && !display.focusedGlyphVisible) return;

    canvas.withTranslation(glyph.item.placement.origin, () => {
      if (!geometryShown) {
        this.#outline.draw(canvas, instance.render.outline, {
          fill: canvas.theme.glyph.fill,
        });
        return;
      }

      this.#outline.draw(canvas, instance.render.outline, {
        fill: display.proofMode ? canvas.theme.glyph.fill : null,
        stroke: {
          color: canvas.theme.glyph.stroke,
          widthPx: canvas.theme.glyph.widthPx,
        },
      });
    });
  }

  #drawDebugOverlays(canvas: Canvas, props: SceneLayerProps, glyph: SceneGlyphFrame): void {
    const { model, geometryShown } = glyph;
    const { display } = props;
    if (!geometryShown || !model || display.proofMode || !display.focusedGlyphVisible) return;
    const { hover } = props.interaction;
    const hoveredSegmentId = hover?.type === "segment" ? hover.segmentId : null;

    canvas.withTranslation(glyph.item.placement.origin, () => {
      this.#debugOverlays.draw(
        canvas,
        model,
        props.view.debugOverlays,
        hoveredSegmentId,
        canvas.pxToUpm(SCREEN_HIT_RADIUS),
      );
    });
  }

  #drawTextRuns(canvas: Canvas): void {
    this.#textLayer.draw(canvas);
  }

  #drawGlyphEditHandles(canvas: Canvas, props: SceneLayerProps, glyph: SceneGlyphFrame): boolean {
    const { instance, geometryShown } = glyph;
    const { display } = props;
    if (
      !geometryShown ||
      display.proofMode ||
      !display.handlesVisible ||
      !display.focusedGlyphVisible ||
      !instance
    ) {
      return false;
    }

    const renderModel = instance.render;
    const sceneBounds = this.#editor.camera.visibleSceneBounds(64);
    const origin = glyph.item.placement.origin;

    canvas.withTranslation(origin, () => {
      this.#controlLines.draw(canvas, renderModel.contours, (from, to) => {
        const minX = Math.min(from.x, to.x) + origin.x;
        const maxX = Math.max(from.x, to.x) + origin.x;
        const minY = Math.min(from.y, to.y) + origin.y;
        const maxY = Math.max(from.y, to.y) + origin.y;
        return !(
          maxX < sceneBounds.minX ||
          minX > sceneBounds.maxX ||
          maxY < sceneBounds.minY ||
          minY > sceneBounds.maxY
        );
      });
    });

    this.#handles.draw(
      canvas,
      canvas.camera,
      origin,
      instance,
      props.interaction.selection,
      props.interaction.hover,
    );

    canvas.withTranslation(origin, () => {
      this.#anchors.draw(canvas, renderModel.anchors, {
        selection: props.interaction.selection,
        hover: props.interaction.hover,
      });
    });

    return true;
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
