import type { DebugOverlays as DebugOverlayState } from "@/types/uiState";
import type { GlyphInstance } from "@/lib/model/Glyph";
import type { Selection } from "@/lib/editor/Selection";
import type { Hover } from "@/lib/editor/Hover";
import { displayAdvance } from "@/lib/utils/unicode";
import { SCREEN_HIT_RADIUS } from "./constants";
import { CanvasItem } from "./CanvasItem";
import type { Canvas } from "./Canvas";
import { OutlineRenderer } from "./Outline";
import { Anchors, ControlLines, DebugOverlays, Guides, Handles, Segments } from "./overlays";
import type { MarkerLayer } from "@/lib/graphics/backends/MarkerLayer";
import type { GlyphNode } from "@/types/node";
import type { Editor } from "../Editor";
import type { SegmentId } from "@shift/glyph-state";

class GlyphFrame {
  readonly node: GlyphNode;
  readonly instance: GlyphInstance;

  constructor(node: GlyphNode, instance: GlyphInstance) {
    this.node = node;
    this.instance = instance;
  }
}

interface BackgroundGlyphFrame {
  readonly node: GlyphNode;
  readonly advance: number;
}

export interface BackgroundLayerProps {
  readonly glyphs: readonly BackgroundGlyphFrame[];
}

interface SceneInteractionProps {
  readonly selection: Selection;
  readonly hover: Hover;
}

interface SceneViewProps {
  readonly debugOverlays: DebugOverlayState;
}

export interface SceneLayerProps {
  readonly glyphs: readonly GlyphFrame[];
  readonly interaction: SceneInteractionProps;
  readonly view: SceneViewProps;
}

export interface OverlayLayerProps {
  readonly activeTool: string | null;
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
    this.#editor.scene.cell.value;

    const glyphs: BackgroundGlyphFrame[] = [];
    for (const node of this.#editor.scene.nodes()) {
      switch (node.kind) {
        case "glyph": {
          const record = this.#editor.font.glyph(node.glyphId);
          if (!record) break;

          const instance = this.#editor.font.instance(
            node.glyphId,
            this.#editor.designLocationCell,
          );
          if (!instance) break;

          const frame = new GlyphFrame(node, instance);
          const unicode = record.unicodes[0] ?? null;

          glyphs.push({
            node: frame.node,
            advance: displayAdvance(frame.instance.xAdvanceCell.value, record.name, unicode),
          });
          break;
        }
      }
    }

    return { glyphs };
  }

  draw(canvas: Canvas): void {
    const props = this.propsCell.value;
    if (!props) return;

    for (const glyph of props.glyphs) {
      canvas.withTranslation(glyph.node.position, () => {
        this.#guides.draw(canvas, this.#editor.font.metrics, glyph.advance);
        this.#editor.toolManager.drawBackground(canvas);
      });
    }
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
 * 4. glyph handles, anchors, and control lines
 *
 * Tool visuals that should appear below point handles, such as a pen preview
 * line, belong in the active tool scene hook. Tool visuals that must appear
 * above handles belong in the overlay layer.
 *
 * Scene props group glyph scene state, interaction state, and view state so
 * render dependencies stay inspectable. Control lines are drawn as part of the
 * handle pass because handles and their control tethers are one visual unit.
 */
export class SceneLayer extends CanvasItem<SceneLayerProps> {
  readonly #editor: Editor;
  readonly #outline = new OutlineRenderer();
  readonly #debugOverlays = new DebugOverlays();
  readonly #controlLines = new ControlLines();
  readonly #anchors = new Anchors();
  readonly #segments = new Segments();
  readonly #handles: Handles;

  /**
   * Creates the scene layer for one editor.
   *
   * @param editor - Editor session whose scene glyphs, selection, and hover are rendered.
   */
  constructor(editor: Editor) {
    super();
    this.#editor = editor;
    this.#handles = new Handles();
  }

  /** Attach the marker layer used by accelerated handle drawing. */
  setMarkerLayer(layer: MarkerLayer | null): void {
    this.#handles.setMarkerLayer(layer);
  }

  protected props(): SceneLayerProps {
    this.#editor.camera.trackViewportTransform();

    // TODO: should be track(thing)
    this.#editor.activeToolCell.value;
    this.#editor.activeToolStateCell.value;
    this.#editor.selection.stateCell.value;
    this.#editor.hover.entryCell.value;
    this.#editor.scene.cell.value;

    const glyphs: GlyphFrame[] = [];
    for (const node of this.#editor.scene.nodes()) {
      switch (node.kind) {
        case "glyph": {
          const instance = this.#editor.font.instance(
            node.glyphId,
            this.#editor.designLocationCell,
          );
          if (!instance) break;

          const frame = new GlyphFrame(node, instance);

          frame.instance.render.trackShape();
          glyphs.push(frame);
          break;
        }
      }
    }

    return {
      glyphs,
      interaction: {
        selection: this.#editor.selection,
        hover: this.#editor.hover,
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
      this.#drawGlyphOutline(canvas, glyph);
      this.#drawDebugOverlays(canvas, props, glyph);
      canvas.withTranslation(glyph.node.position, () => {
        this.#editor.toolManager.drawScene(canvas);
      });
    }

    let drewHandles = false;
    for (const glyph of props.glyphs) {
      drewHandles = this.#drawGlyphEditHandles(canvas, props, glyph) || drewHandles;
    }
    if (!drewHandles) this.#handles.clear();
  }

  #drawGlyphOutline(canvas: Canvas, glyph: GlyphFrame): void {
    canvas.withTranslation(glyph.node.position, () => {
      this.#outline.draw(canvas, glyph.instance.render.outline, {
        fill: null,
        stroke: {
          color: canvas.theme.glyph.stroke,
          widthPx: canvas.theme.glyph.widthPx,
        },
      });
    });
  }

  #drawDebugOverlays(canvas: Canvas, props: SceneLayerProps, glyph: GlyphFrame): void {
    const { hover } = props.interaction;
    const hoveredObject = hover.entry ? this.#editor.object(hover.entry) : null;
    const hoveredSegmentId =
      hoveredObject?.kind === "segment" && hoveredObject.node.id === glyph.node.id
        ? hoveredObject.segmentId
        : null;

    canvas.withTranslation(glyph.node.position, () => {
      this.#debugOverlays.draw(
        canvas,
        glyph.instance.geometry,
        props.view.debugOverlays,
        hoveredSegmentId,
        canvas.pxToUpm(SCREEN_HIT_RADIUS),
      );
    });
  }

  #selectedSegmentIds(glyph: GlyphFrame): readonly SegmentId[] {
    const segmentIds: SegmentId[] = [];

    for (const object of this.#editor.objects(this.#editor.selection.ids)) {
      if (object.kind !== "segment") continue;
      if (object.node.id !== glyph.node.id) continue;

      segmentIds.push(object.segmentId);
    }

    return segmentIds;
  }

  #hoveredSegmentId(glyph: GlyphFrame): SegmentId | null {
    const id = this.#editor.hover.id;
    if (!id) return null;

    const object = this.#editor.object(id);
    if (object?.kind !== "segment") return null;
    if (object.node.id !== glyph.node.id) return null;

    return object.segmentId;
  }

  #drawGlyphEditHandles(canvas: Canvas, props: SceneLayerProps, glyph: GlyphFrame): boolean {
    const renderModel = glyph.instance.render;
    const sceneBounds = this.#editor.camera.visibleSceneBounds(64);
    const origin = glyph.node.position;

    canvas.withTranslation(origin, () => {
      this.#segments.draw(
        canvas,
        glyph.instance.geometry,
        this.#selectedSegmentIds(glyph),
        this.#hoveredSegmentId(glyph),
      );
    });

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
      glyph.node,
      glyph.instance,
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
 * hover, and active tool. The renderer supplies a canvas whose context is
 * already in scene coordinates for the current frame.
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
