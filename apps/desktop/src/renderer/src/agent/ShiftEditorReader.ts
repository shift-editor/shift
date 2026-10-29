import type {
  AuthoredContour,
  DocumentState,
  EditorView,
  KerningGapView,
  KerningPairSideView,
  KerningToolView,
  SpacingGapSide,
  SpacingHalfView,
  SpacingToolView,
  TextRunGlyph,
  TextRunItem,
  TextRunView,
} from "@shift/runtime";
import type { Editor } from "@shift/editor";
import type { ScenePoint } from "@shift/editor/spaces";
import { isGroupSide, type KerningPairPosition } from "@shift/editor/model";
import type { GlyphOutlineTarget, PositionGuide } from "@shift/editor/types";
import { ascending, comparing, type PointId, type Source, type SourceId } from "@shift/types";
import type { TextItem } from "@shift/editor/text";
import type { KerningPair, SpacingTool } from "@shift/editor/tools";
import type { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";

/** One point handle the canvas draws, and how it is styled. */
export interface DrawnHandle {
  pointId: PointId;
  /** `interpolated` between sources, where handles show no selection or hover. */
  state: "idle" | "hovered" | "selected" | "interpolated";
}

/** The canvas camera: its zoom level and how far it is panned, in screen pixels. */
export interface CanvasCamera {
  zoom: number;
  pan: { x: number; y: number };
}

/** One selected object and its kind (`point`, `segment`, `contour`, `component`, `anchor`, …). */
export interface SelectedObject {
  id: string;
  kind: string;
}

/** A rectangle in the open glyph's units. */
export interface GlyphRect {
  min: { x: number; y: number };
  max: { x: number; y: number };
}

/** A point an edit also moves: the source whose layer holds it, its id, and where it is now. */
export interface MatchedPoint {
  sourceId: SourceId;
  pointId: PointId;
  x: number;
  y: number;
}

/**
 * Public reads of one editor's view: its open glyph, sources, location,
 * selection, tool, edit and save state.
 *
 * @remarks
 * Returns runtime DTOs. Revision guarding and transport belong to the caller.
 */
export class ShiftEditorReader {
  readonly #editor: Editor;
  readonly #edits: WorkspaceEditCoordinator | null;

  /**
   * @param edits - The workspace's edit coordinator; null for a session
   * without a workspace (a preview or an in-memory font).
   */
  constructor(editor: Editor, edits: WorkspaceEditCoordinator | null) {
    this.#editor = editor;
    this.#edits = edits;
  }

  /**
   * @param route - The window's route, which only the window knows.
   */
  inspect(route: string): EditorView {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    const entry = node ? editor.font.entryForId(node.glyphId) : null;
    const glyph =
      node && entry
        ? {
            glyphId: node.glyphId,
            name: entry.name,
            nodeId: node.id,
            sourceId: node.sourceId,
          }
        : null;
    const tool = editor.tool;

    return {
      route,
      glyph,
      activeSourceId: editor.activeSourceId,
      editingSourceIds: [...editor.editingSourceIds],
      externalLocation: [...editor.externalLocation].map(([axisId, value]) => ({ axisId, value })),
      selectionIds: [...editor.selection.ids],
      tool: tool ? { id: tool.id, state: tool.state.type } : null,
      dragging: editor.isDragging,
      editing: editor.isEditing,
      applyStatus: this.#edits?.applyStatusCell.peek() ?? null,
    };
  }

  /** The canvas camera: its zoom level and pan. */
  camera(): CanvasCamera {
    const { zoom, pan } = this.#editor;
    return { zoom, pan: { x: pan.x, y: pan.y } };
  }

  /** The id of the object under the pointer, or null when nothing is hovered. */
  hoveredId(): string | null {
    return this.#editor.hover.id ?? null;
  }

  /** The selected objects with their kinds, in selection order; an id the glyph no longer has is left out. */
  selectedObjects(): SelectedObject[] {
    const editor = this.#editor;
    return editor.selection.ids.flatMap((id) => {
      const object = editor.object(id);
      return object ? [{ id, kind: object.kind }] : [];
    });
  }

  /** The selection's bounds in the open glyph's units, a gesture's preview included; null when nothing bounded is selected. */
  selectionBounds(): GlyphRect | null {
    const bounds = this.#editor.selectionBounds();
    return bounds ? { min: { ...bounds.min }, max: { ...bounds.max } } : null;
  }

  /** The scene nodes being edited in place, in the order they were entered; empty when none is. */
  editingNodeIds(): string[] {
    return [...this.#editor.editing.nodeIds];
  }

  /**
   * Where an edit of the active layer's point `pointId` moves a point in each source being
   * edited: the active source first, then each other one, a gesture's preview included.
   *
   * @returns one entry per layer the edit moves; empty when the point is not editable.
   */
  matchedPoints(pointId: PointId): MatchedPoint[] {
    const selection = this.#editor.positionSelection([pointId]);
    if (!selection) return [];

    return [selection, ...selection.additionalLayers].flatMap(({ layer, targets }) => {
      const id = targets.points?.[0];
      const point = id ? layer.point(id) : null;
      return id && point
        ? [{ sourceId: layer.source.id, pointId: id, x: point.x, y: point.y }]
        : [];
    });
  }

  /** Whether the editor tracks a pointer over the canvas, or one a gesture has captured. */
  hasPointer(): boolean {
    return this.#editor.input.pointer !== null;
  }

  /**
   * The two handles the Select tool previews on the Cmd-hovered line segment, at one and two
   * thirds of it, in the open glyph's units; null while it previews none.
   */
  drawnUpgradePreview(): { x: number; y: number }[] | null {
    const editor = this.#editor;
    const preview = editor.toolIf("select")?.upgradePreview.propsSnapshot() ?? null;
    const node = editor.scene.first("glyph");
    if (!preview || !node) return null;

    return preview.map((scene) => {
      const { x, y } = editor.toLocal(node, scene as ScenePoint);
      return { x, y };
    });
  }

  /** Where the Pen's drag places the outgoing handle now, in glyph units; null outside a Pen drag. */
  drawnPenHandle(): { x: number; y: number } | null {
    const state = this.#editor.toolIf("pen")?.state;
    if (state?.type !== "dragging") return null;

    const { x, y } = state.curve.handlePosition;
    return { x, y };
  }

  /** The source the editor shows and edits, or null between sources. */
  activeSource(): Source | null {
    const editor = this.#editor;
    const sourceId = editor.activeSourceId;
    return sourceId ? editor.font.source(sourceId) : null;
  }

  /**
   * The window's document and whether it has unsaved edits, read behind every
   * edit already made.
   *
   * @returns null for a session without a document (a preview or an
   * in-memory font).
   */
  async documentState(): Promise<DocumentState | null> {
    const state = await this.#edits?.state();
    if (!state) return null;

    const { sourceKind, saveTarget, canonicalPath, dirty, needsSaveAs } = state;
    return { sourceKind, saveTarget, path: canonicalPath, dirty, needsSaveAs };
  }

  /**
   * The open glyph's outline as the canvas draws it now, the uncommitted
   * preview of a gesture in flight included.
   *
   * @returns the active source's contours; empty when no glyph is open or no
   * source is active.
   */
  drawnOutline(): AuthoredContour[] {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    const sourceId = editor.activeSourceId;
    if (!node || !sourceId) return [];

    const layer = editor.layerForGlyph(node.glyphId, sourceId);
    if (!layer) return [];

    return layer.contours.map((contour) => ({
      id: contour.id,
      closed: contour.closed,
      points: contour.points.map(({ id, x, y, pointType, smooth }) => ({
        id,
        x,
        y,
        pointType,
        smooth,
      })),
    }));
  }

  /**
   * The point handles the canvas draws on the open glyph, in outline order.
   * Handles hidden while a gesture owns their contour are left out.
   */
  drawnHandles(): DrawnHandle[] {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    if (!node) return [];

    const states = editor.nodeDefinition("glyph").handleStates(node);
    return [...states].map(([pointId, state]) => ({ pointId, state }));
  }

  /**
   * The source and instance outlines the canvas draws around the open glyph: sources first, in
   * the font's source order, then instances, in the font's instance order.
   */
  drawnOutlineTargets(): GlyphOutlineTarget[] {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    if (!node) return [];

    const { sources, namedInstances } = editor.font;
    const sourceOrder = new Map(sources.map((source, index) => [source.id, index]));
    const instanceOrder = new Map(
      namedInstances.map((instance, index) => [instance.id, sources.length + index]),
    );
    const rank = (target: GlyphOutlineTarget) =>
      target.kind === "source"
        ? (sourceOrder.get(target.sourceId) ?? -1)
        : (instanceOrder.get(target.instanceId) ?? -1);
    return editor
      .nodeDefinition("glyph")
      .visibleOutlines(node.id)
      .toSorted(comparing(rank, ascending));
  }

  /**
   * The snap guides the active tool draws for the gesture in flight, in glyph
   * units; empty when nothing snaps or no gesture is in flight.
   */
  drawnSnapGuides(): PositionGuide[] {
    return [...(this.#editor.toolManager.activeTool?.snapGuides ?? [])];
  }

  /**
   * The canvas text run as it shows now: its items, the glyphs they lay out
   * to, and the caret.
   *
   * @returns null when the canvas shows no text run.
   */
  textRun(): TextRunView | null {
    const editor = this.#editor;
    const node = editor.scene.first("textRun");
    const run = node ? editor.text.run(node.runId) : null;
    const layout = node ? editor.text.layout(node.runId) : null;
    if (!node || !run || !layout) return null;

    const itemIds = new Set(run.items.map((item) => item.id));
    const open = editor.nodeDefinition("textRun").childGlyph(node);
    const edited = open && editor.editing.nodeIds.includes(open.id) ? (open.itemId ?? null) : null;
    const hovered = editor.hover.id;
    const caret = editor.textEditing.caretIn(node.id);

    return {
      items: run.items.map((item) => this.#textRunItem(item)),
      glyphs: layout.placedGlyphs.map(
        (placed): TextRunGlyph => ({
          glyphId: placed.glyph.glyphId,
          name: placed.glyph.glyphName,
          itemIds: [...placed.glyph.sourceItemIds],
          line: placed.lineIndex,
          left: placed.left,
          baseline: placed.baseline,
          origin: { x: placed.origin.x, y: placed.origin.y },
          advance: placed.glyph.xAdvance,
          kern: placed.glyph.xKern,
        }),
      ),
      advance: layout.totalAdvance,
      baselines: layout.lines.map((line) => line.y),
      openItemId: open?.itemId ?? null,
      openGlyph: open ? editor.font.glyphName(open.glyphId) : null,
      editedItemId: edited,
      hoveredItemId: hovered !== null && itemIds.has(hovered as never) ? hovered : null,
      caret: caret
        ? {
            position: caret.cluster,
            selection: { ...caret.selection },
            x: caret.position.x,
            y: caret.position.y,
          }
        : null,
    };
  }

  /**
   * What the Spacing tool shows: the sidebearing under the pointer, the one
   * selected, and the one whose value field is open; the last two measured
   * now, so null once their glyphs are gone.
   *
   * @returns null when the Spacing tool is not active.
   */
  spacingTool(): SpacingToolView | null {
    const tool = this.#editor.toolIf("spacing");
    if (!tool) return null;

    const { hovered, selected, editing } = tool;
    return {
      hovered: hovered ? this.#spacingHalf(hovered) : null,
      selected: selected ? this.#spacingHalf(selected) : null,
      editing: editing ? this.#spacingHalf(editing) : null,
      sameAsHovered: hovered
        ? tool.runs.sameSidebearings(hovered).map((half) => this.#spacingHalf(half))
        : [],
      overValue: tool.overValue,
      quiet: tool.quiet,
    };
  }

  /**
   * What the Kerning tool shows: the kern under the pointer, the one selected,
   * which the sidebar shows, and the one whose value field is open.
   *
   * @returns null when the Kerning tool is not active.
   */
  kerningTool(): KerningToolView | null {
    const tool = this.#editor.toolIf("kerning");
    if (!tool) return null;

    const { hovered, currentPair: selected, editing } = tool;
    return {
      hovered: hovered ? this.#kerningGap(hovered) : null,
      selected: selected ? this.#kerningGap(selected) : null,
      editing: editing ? this.#kerningGap(editing) : null,
      sameAsHovered: hovered
        ? tool.runs.samePairs(hovered).map((pair) => this.#kerningGap(pair))
        : [],
    };
  }

  #textRunItem(item: TextItem): TextRunItem {
    if (item.kind === "linebreak") return { id: item.id, text: "\n" };
    if (item.kind === "character")
      return { id: item.id, text: String.fromCodePoint(item.codepoint) };
    return { id: item.id, text: `/${this.#editor.font.glyphName(item.glyphId) ?? ""}` };
  }

  #spacingHalf(half: NonNullable<SpacingTool["currentHalf"]>): SpacingHalfView {
    const { gap } = half;
    return {
      side: half.side,
      scope: half.scope,
      gap: {
        left: gap.left ? this.#spacingSide(gap.left) : null,
        right: gap.right ? this.#spacingSide(gap.right) : null,
        leftBoundary: gap.leftBoundary,
        rightBoundary: gap.rightBoundary,
        baseline: gap.baseline,
        top: gap.top,
        bottom: gap.bottom,
      },
    };
  }

  #spacingSide(
    side: NonNullable<NonNullable<SpacingTool["currentHalf"]>["glyphSide"]>,
  ): SpacingGapSide {
    return {
      itemId: side.itemId,
      glyph: this.#editor.font.glyphName(side.glyphId) ?? "",
      sidebearing: side.sidebearing,
      edge: side.edge,
    };
  }

  #kerningGap(pair: KerningPair): KerningGapView {
    const editor = this.#editor;
    const editable = pair.editablePair(editor);
    const side = (position: KerningPairPosition): KerningPairSideView => {
      const id = editable![position];
      const lock = pair.lock(editor, position);
      return { name: editor.font.kerningSideName(id) ?? "", group: isGroupSide(id), ...lock };
    };
    return {
      firstItemId: pair.gap.left.itemId,
      secondItemId: pair.gap.right.itemId,
      amount: pair.amount,
      center: pair.center,
      baseline: pair.gap.baseline,
      bottom: pair.gap.bottom,
      pair: editable
        ? { first: side("first"), second: side("second"), amount: editable.amount }
        : null,
    };
  }
}
