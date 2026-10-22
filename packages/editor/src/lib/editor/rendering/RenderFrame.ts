import { CanvasItem } from "./CanvasItem";
import { track } from "../../signals";
import type { Canvas } from "./Canvas";
import type { RenderContext, RenderPass } from "../../../types/rendering";
import type { Editor } from "../Editor";
import type { VisibleNode, VisibleNodes } from "./VisibleNodes";

/** The background layer draws from {@link VisibleNodes}; its props only mark when to redraw. */
export type BackgroundLayerProps = Record<string, never>;

/** The scene layer draws from {@link VisibleNodes}; its props only mark when to redraw. */
export type SceneLayerProps = Record<string, never>;

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
  readonly #visible: VisibleNodes;

  /**
   * Creates the background layer for one editor.
   *
   * @param editor - Editor session whose camera, glyph, and active tool are rendered.
   * @param visible - the nodes on screen, shared with the scene layer.
   */
  constructor(editor: Editor, visible: VisibleNodes) {
    super();
    this.#editor = editor;
    this.#visible = visible;
  }

  protected props(): BackgroundLayerProps | null {
    this.#editor.toolCell.value;
    this.#editor.editing.stateCell.value;
    track(this.#editor.textEditing.stateCell);

    return {};
  }

  draw(ctx: RenderContext): void {
    const props = this.propsCell.value;
    if (!props) return;

    track(this.#visible.cell);
    for (const entry of this.#visible.cell.peek()) {
      drawNode(this.#editor, ctx, entry, "background");
    }

    this.#editor.toolManager.drawBackground(ctx.canvas);
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
  readonly #visible: VisibleNodes;

  /**
   * Creates the scene layer for one editor.
   *
   * @param editor - Editor session whose scene glyphs, selection, and hover are rendered.
   * @param visible - the nodes on screen, shared with the background layer.
   */
  constructor(editor: Editor, visible: VisibleNodes) {
    super();
    this.#editor = editor;
    this.#visible = visible;
  }

  protected props(): SceneLayerProps {
    // TODO: should be track(thing)
    this.#editor.toolCell.value;
    this.#editor.editing.stateCell.value;
    this.#editor.selection.stateCell.value;
    this.#editor.hover.entryCell.value;
    track(this.#editor.textEditing.stateCell);
    this.#editor.debugOverlaysCell.value;

    return {};
  }

  draw(ctx: RenderContext): void {
    const props = this.propsCell.value;
    if (!props) return;

    track(this.#visible.cell);
    const entries = this.#visible.cell.peek();
    for (const entry of entries) drawNode(this.#editor, ctx, entry, "content");

    for (const { node, transform } of entries) {
      if (node.kind !== "glyph") continue;

      ctx.canvas.withTransform(transform, () => {
        this.#editor.toolManager.drawScene(ctx.canvas);
      });
    }

    for (const entry of entries) drawNode(this.#editor, ctx, entry, "controls");
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
    const tool = this.#editor.toolCell.value;

    return {
      activeTool: tool?.id ?? null,
      activeToolState: tool?.state ?? null,
    };
  }

  draw(canvas: Canvas): void {
    const props = this.propsCell.value;
    if (!props) return;

    this.#editor.toolManager.drawOverlay(canvas);
  }
}

function drawNode(editor: Editor, ctx: RenderContext, entry: VisibleNode, pass: RenderPass): void {
  const definition = editor.nodeDefinition(entry.node.kind);
  if (!definition) return;

  ctx.canvas.withTransform(entry.transform, () => {
    definition.draw(entry.node, ctx, pass);
  });
}
