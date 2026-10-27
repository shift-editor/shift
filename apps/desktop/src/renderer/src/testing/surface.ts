/**
 * What a behaviour test may do to the editor and read back from it.
 *
 * @remarks
 * Behaviour tests are typed against this interface, not the `Editor` class, so
 * the type checker rejects any read of the editor's internals (its managers,
 * signal cells, the edit coordinator, packed layer state). Each read returns
 * plain data, so renaming or moving editor internals never reaches a test;
 * only {@link TestEditor}'s implementation changes.
 *
 * Every method is named for something a user does or sees. Reads are the
 * agent read API (`@shift/runtime`, served to MCP by the window's agent
 * readers), so a test observes exactly what an agent can, and the harness has
 * no read logic of its own to bend. When a test needs a read that is not
 * there, add it to the agent readers, not here. Actions are named for what a
 * user does, never one that forwards an internal. {@link EditorTestSurface.asEditor} is the one escape hatch, and
 * lint allows it only as a call argument, for code under test that takes an
 * `Editor`.
 */
import type { DeleteMode, Editor } from "@shift/editor";
import type { ToolName } from "@shift/editor/tools";
import type { AlignmentType, DistributeType } from "@shift/editor/transform";
import type { Bounds, Point2D } from "@shift/geo";
import type {
  AuthoredAnchor,
  AuthoredComponent,
  AuthoredContour,
  AuthoredLayer,
  AuthoredPoint,
  FontOverview,
  GlyphSummary,
  KerningGroupSummary,
  KerningMasterValue,
  ResolvedLocation,
} from "@shift/runtime";
import type {
  AnchorId,
  ComponentId,
  GlyphName,
  KerningPosition,
  MetricKind,
  PointId,
  SelectableId,
} from "@shift/types";
import type { EditorCommandId } from "@shared/commands";
import type { WorkspaceDocumentState } from "@shared/workspace/protocol";
import type { GlyphFixture, PointNames } from "./fixtures";

/** Keyboard modifiers held during a gesture. */
export interface Modifiers {
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
}

/**
 * The open glyph's authored contours, as `@shift/runtime`'s `layers.get`
 * returns them to agents.
 */
export type Outline = readonly AuthoredContour[];

/** A new axis, as the Axes panel creates one. */
export interface AxisFixture {
  readonly tag: string;
  readonly name: string;
  readonly minimum: number;
  readonly default: number;
  readonly maximum: number;
}

/** A position along each named axis, keyed by axis tag, in user (external) units. */
export type AxisLocation = Readonly<Record<string, number>>;

/**
 * A glyph as the canvas draws it at the current location: interpolated
 * between sources, with its components decomposed and their anchors shown.
 * Test-only: agents read authored layers, not the canvas.
 */
export interface DrawnGlyph {
  readonly advanceWidth: number;
  readonly bounds: Bounds | null;
  readonly sidebearings: { readonly lsb: number | null; readonly rsb: number | null };
  /** Each placed component, by its base glyph's name, with where it is placed and the bounds it draws. */
  readonly components: readonly {
    readonly glyph: string;
    readonly dx: number;
    readonly dy: number;
    readonly bounds: Bounds | null;
  }[];
  /** The glyph's anchors with those it takes from its components, by name. */
  readonly anchors: readonly { readonly name: string; readonly x: number; readonly y: number }[];
}

export interface EditorTestSurface {
  /**
   * Builds `fixture` into the open glyph through the editor's own commands.
   *
   * @remarks
   * The drawing is undoable like any edit: the engine keeps its own undo
   * stack, which setup cannot yet opt out of. Undo only what the test did.
   *
   * @returns the minted point ids, keyed by each point's `name`.
   */
  draw<const F extends GlyphFixture>(fixture: F): Promise<Record<PointNames<F>, PointId>>;

  /** Makes `name` the active tool. */
  selectTool(name: ToolName): void;
  /** Replaces the selection with `ids`. */
  select(ids: readonly PointId[]): void;
  /** Clicks at a glyph-local position and waits for the edit it makes. */
  clickAt(position: Point2D, modifiers?: Modifiers): Promise<void>;
  /** Drags point `id` by `by` in glyph units, as the pointer does, and waits for the edit. */
  dragPoint(id: PointId, by: Point2D, modifiers?: Modifiers): Promise<void>;
  /** Starts dragging point `id` by `by` and holds it before release, so the edit is only previewed. */
  holdDrag(id: PointId, by: Point2D, modifiers?: Modifiers): void;
  /** Abandons the gesture in flight, as losing pointer capture does. */
  cancelGesture(): void;
  /** Presses a key and waits for the edit it makes. */
  pressKey(key: string, modifiers?: Modifiers): Promise<void>;
  /**
   * Deletes the selection, as Edit › Delete does.
   *
   * @param mode - `"fit"` joins the neighbours with a fitted curve; `"gap"` opens the contour.
   */
  deleteSelection(mode?: DeleteMode): Promise<boolean>;
  /** Sets the open glyph's advance width, as the sidebar's width field does. */
  setAdvanceWidth(width: number): void;

  /**
   * Sets the kerning between two glyphs at a source, as typing into the
   * kerning field does: the value of whichever pair applies changes, and
   * shows at once, before the workspace confirms it. `null` removes that pair.
   *
   * @throws {Error} when the engine refuses the value.
   */
  setKerning(source: string, first: string, second: string, amount: number | null): void;
  /**
   * Shows `amount` between two glyphs at a source without committing it, as
   * dragging with the Kerning tool does. {@link cancelGesture} discards it.
   */
  previewKerning(source: string, first: string, second: string, amount: number): void;
  /**
   * Locks one side of the pair at a source to its glyph, making an exception
   * to its group there, or unlocks it back to the group, as the kerning
   * panel's lock does.
   *
   * @returns false when that side has no group to lock against.
   */
  setKerningException(
    source: string,
    first: string,
    second: string,
    side: KerningPosition,
    locked: boolean,
  ): Promise<boolean>;
  /** Creates a kerning group holding `glyphs`. */
  createKerningGroup(
    position: KerningPosition,
    name: string,
    glyphs: readonly string[],
  ): Promise<void>;
  /** Moves `glyphs` into the named group, or out of any group when `group` is null. */
  moveToKerningGroup(
    position: KerningPosition,
    glyphs: readonly string[],
    group: string | null,
  ): Promise<void>;
  renameKerningGroup(position: KerningPosition, name: string, newName: string): Promise<void>;
  deleteKerningGroup(position: KerningPosition, name: string): Promise<void>;

  /** Opens the glyph named `name` on the canvas, as choosing it in the glyph grid does. */
  openGlyph(name: string): Promise<void>;
  /** Replaces the selection with any mix of points, anchors and components. */
  selectObjects(ids: readonly SelectableId[]): void;
  /** Clicks twice at a glyph-local position and waits for the edit it makes. */
  doubleClickAt(position: Point2D, modifiers?: Modifiers): Promise<void>;
  /** Moves the pointer to a glyph-local position without pressing, as hovering does. */
  hoverAt(position: Point2D): void;
  /** Drags anchor `id` by `by` in glyph units, as the pointer does, and waits for the edit. */
  dragAnchor(id: AnchorId, by: Point2D, modifiers?: Modifiers): Promise<void>;
  /** Starts dragging anchor `id` by `by` and holds it before release, so the edit is only previewed. */
  holdDragAnchor(id: AnchorId, by: Point2D, modifiers?: Modifiers): void;
  /**
   * Runs an app command, as its menu item or shortcut does, and waits for the edit.
   *
   * @returns false when the command does not apply to the selection.
   */
  runCommand(id: EditorCommandId): Promise<boolean>;
  /** Aligns the selected points to an edge or center of their bounds, as the sidebar's align buttons do. */
  alignSelection(alignment: AlignmentType): boolean;
  /** Spaces the selected points evenly, as the sidebar's distribute buttons do. */
  distributeSelection(type: DistributeType): boolean;
  /** Mirrors the selection across its center, as the sidebar's flip buttons do. */
  flipSelection(axis: "horizontal" | "vertical"): boolean;
  /** Rotates the selection about its center, as the sidebar's rotation field does. */
  rotateSelection(degrees: number): boolean;
  /** Sets the open glyph's left sidebearing, moving its outline, as the sidebar's LSB field does. */
  setLeftSidebearing(value: number): void;
  /** Sets the open glyph's right sidebearing by changing its advance, as the sidebar's RSB field does. */
  setRightSidebearing(value: number): void;
  /** Adds an anchor at a glyph-local position in every source being edited, and selects it. */
  addAnchorAt(position: Point2D): boolean;
  /** Renames an anchor in every source being edited, as the sidebar's anchor name field does. */
  renameAnchor(anchorId: AnchorId, name: string): boolean;
  /** Moves anchors to one coordinate on an axis, as the sidebar's anchor position fields do. */
  setAnchorAxis(anchorIds: readonly AnchorId[], axis: "x" | "y", value: number): boolean;
  /**
   * Anchors the selected components onto their bases' anchors, or frees them
   * to stay put, as the sidebar's anchoring toggle does.
   */
  setSelectedComponentsAnchored(anchored: boolean): Promise<boolean>;
  /** Creates the glyph `name` and adds it as a component, as the Add Component dialog does for a missing glyph. */
  createGlyphAndAddComponent(name: GlyphName): Promise<ComponentId | null>;
  /** Adds an axis to the font, as the Axes panel does. */
  addAxis(axis: AxisFixture): Promise<void>;
  /**
   * Replaces the font's axis mappings with one for the axis tagged `tag`, as
   * the axis mapping editor does.
   *
   * @param points - Each user (external) value and the design value it maps to.
   */
  mapAxis(tag: string, points: readonly (readonly [user: number, design: number])[]): Promise<void>;
  /** Adds a source at `location` and moves there, as the Sources panel's add button does. */
  addSource(name: string, location: AxisLocation): Promise<void>;
  /** Moves a source's metric line, as the source's metrics fields do. */
  setSourceMetric(source: string, metric: MetricKind, position: number): Promise<void>;
  /**
   * Selects sources for editing, as clicking and Command-clicking rows in the
   * Sources panel does: the first becomes the active source, and edits apply
   * to all of them once their layers match.
   */
  editSources(names: readonly string[]): Promise<void>;
  /** Moves to a location, as the axis sliders do; an exact source there becomes active. */
  setLocation(location: AxisLocation): void;

  /** The open glyph's authored outline, as agents read it. */
  outline(): Promise<Outline>;
  /** One authored point of the open glyph, or null when it has none with that id. */
  point(id: PointId): Promise<AuthoredPoint | null>;
  /** The open glyph's anchors, in order. */
  anchors(): Promise<readonly AuthoredAnchor[]>;
  /** The open glyph's components, in order. */
  components(): Promise<readonly AuthoredComponent[]>;
  /** Where each point is now, as the open glyph's authored layer stores it. */
  pointPositions(ids: readonly PointId[]): Promise<Record<PointId, Point2D>>;
  /** The open glyph's advance width. */
  advanceWidth(): Promise<number>;
  /** The kerning between two glyphs at every source, in font source order. */
  kerning(first: string, second: string): readonly KerningMasterValue[];
  /** The kerning between two glyphs at the source named `source`; null when the font has none. */
  kerningAt(source: string, first: string, second: string): KerningMasterValue | null;
  /** The kerning groups at a position, in name order. */
  kerningGroups(position: KerningPosition): readonly KerningGroupSummary[];
  /** The kerning group named `name` at a position, or null. */
  kerningGroup(position: KerningPosition, name: string): KerningGroupSummary | null;
  /** The kerning group the glyph named `glyph` belongs to at a position, or null. */
  kerningGroupOf(position: KerningPosition, glyph: string): KerningGroupSummary | null;
  /** The selected ids, in selection order. */
  selectionIds(): readonly string[];
  /** The CSS cursor the editor shows. Test-only: not agent data. */
  shownCursor(): string;
  /** Flushes pending edits and reads the document's save state. Test-only: not agent data. */
  documentState(): Promise<WorkspaceDocumentState | null>;

  /** The open glyph's authored layer at the source named `source`, as agents read it. */
  layerAt(source: string): Promise<AuthoredLayer>;
  /** The open glyph's point at a position in the active source, or null. */
  pointAt(position: Point2D): Promise<AuthoredPoint | null>;
  /** The open glyph's anchor named `name` in the active source, or null. */
  anchorNamed(name: string): Promise<AuthoredAnchor | null>;
  /** The glyph named `name` in the font directory, or null when the font has none. */
  glyphNamed(name: string): GlyphSummary | null;
  /** The font's axes, sources, instances and metrics, as agents read them. */
  fontOverview(): FontOverview;
  /** The current location resolved: its design coordinates, the source there, and the metrics. */
  location(): ResolvedLocation;
  /** Whether the selected components are anchored, as the sidebar's anchoring toggle shows; null without components selected. */
  selectedComponentsAnchored(): boolean | null;
  /** Whether Decompose Components applies to the selection. */
  canDecomposeSelection(): boolean;
  /** A glyph as the canvas draws it at the current location; the open glyph when `glyph` is omitted. */
  drawnGlyph(glyph?: string): Promise<DrawnGlyph>;

  /** Adds a glyph to the font and loads it. */
  addGlyph(name: string, unicode: number | null): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** Waits for every pending edit to be confirmed. */
  settle(): Promise<void>;
  /**
   * Saves the document, as File › Save does. A document never saved yet is
   * saved to a temporary file, as if Save As chose one; {@link close} removes it.
   */
  save(): Promise<WorkspaceDocumentState>;

  /**
   * Saves the document to a temporary file and opens it in a new editor on the
   * same glyph. Close the returned editor with {@link close}.
   */
  reopen(): Promise<EditorTestSurface>;
  /** Closes the document without saving and disposes the editor. */
  close(): Promise<void>;

  /** The editor itself, only to pass to code under test that takes an `Editor`. */
  asEditor(): Editor;
}
