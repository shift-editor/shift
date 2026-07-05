import { displayAdvance } from "@/lib/utils/unicode";
import { CanvasItem } from "./CanvasItem";
import type { Canvas } from "./Canvas";
import { Guides } from "./overlays";
import type { GlyphNode, ShiftNode } from "@/types/node";
import type { RenderContext, RenderPass } from "@/types/rendering";
import type { Editor } from "../Editor";

interface BackgroundGlyphFrame {
  readonly node: GlyphNode;
  readonly advance: number;
}

export interface BackgroundLayerProps {
  readonly glyphs: readonly BackgroundGlyphFrame[];
}

export interface SceneLayerProps {
  readonly nodes: readonly ShiftNode[];
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

          const unicode = record.unicodes[0] ?? null;

          glyphs.push({
            node,
            advance: displayAdvance(instance.xAdvanceCell.value, record.name, unicode),
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

  /**
   * Creates the scene layer for one editor.
   *
   * @param editor - Editor session whose scene glyphs, selection, and hover are rendered.
   */
  constructor(editor: Editor) {
    super();
    this.#editor = editor;
  }

  protected props(): SceneLayerProps {
    this.#editor.camera.trackViewportTransform();

    // TODO: should be track(thing)
    this.#editor.activeToolCell.value;
    this.#editor.activeToolStateCell.value;
    this.#editor.selection.stateCell.value;
    this.#editor.hover.entryCell.value;
    this.#editor.scene.cell.value;
    this.#editor.debugOverlaysCell.value;

    return {
      nodes: this.#editor.scene.nodes(),
    };
  }

  draw(ctx: RenderContext): void {
    const props = this.propsCell.value;
    if (!props) return;

    for (const node of props.nodes) {
      this.#drawNode(ctx, node, "content");
    }

    for (const node of props.nodes) {
      if (node.kind !== "glyph") continue;

      ctx.canvas.withTranslation(node.position, () => {
        this.#editor.toolManager.drawScene(ctx.canvas);
      });
    }

    for (const node of props.nodes) {
      this.#drawNode(ctx, node, "controls");
    }
  }

  #drawNode(ctx: RenderContext, node: ShiftNode, pass: RenderPass): void {
    const definition = this.#editor.nodeDefinition(node.kind);
    if (!definition) return;

    ctx.canvas.withTranslation(node.position, () => {
      definition.draw(node, ctx, pass);
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
