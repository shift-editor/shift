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
import type { Bounds, Point2D, Rect2D } from "@shift/geo";
import type {
  AuthoredAnchor,
  AuthoredComponent,
  AuthoredContour,
  AuthoredLayer,
  AuthoredPoint,
  FontOverview,
  GlyphSummary,
  EditorTool,
  KerningGroupSummary,
  KerningMasterValue,
  ResolvedGlyph,
  ResolvedLocation,
} from "@shift/runtime";
import type { PositionGuide } from "@shift/editor/types";
import type {
  AnchorId,
  AxisDefinition,
  ComponentId,
  GlyphName,
  KerningPosition,
  MetricKind,
  PointId,
  SelectableId,
  SourceMetrics,
} from "@shift/types";
import type { EditorCommandId } from "@shared/commands";
import type { GlyphOutlineTarget, PositionGuide } from "@shift/editor/types";
import type { KerningPosition, PointId, Source, SourceMetrics } from "@shift/types";
import type { DrawnHandle } from "@/agent/ShiftEditorReader";
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

/** A designspace location as each axis's user-facing value, keyed by axis tag; unnamed axes sit at their default. */
export type AxisValues = Readonly<Record<string, number>>;
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
  /** Presses the pointer at a glyph-local position, starting a gesture. */
  pressAt(position: Point2D, modifiers?: Modifiers): void;
  /**
   * Moves the pointer to a glyph-local position and lets a frame pass, so the
   * move is handled. With no button pressed this hovers.
   */
  movePointerTo(position: Point2D, modifiers?: Modifiers): void;
  /** Moves the pointer without a frame passing, so the move is still queued when the next event arrives. */
  queuePointerMove(position: Point2D, modifiers?: Modifiers): void;
  /** Releases the pointer at a glyph-local position and waits for the edit it makes. */
  releaseAt(position: Point2D, modifiers?: Modifiers): Promise<void>;
  /**
   * Drags from one glyph-local position to another, crossing the drag
   * threshold a few units along, and waits for the edit.
   */
  dragFrom(from: Point2D, to: Point2D, modifiers?: Modifiers): Promise<void>;
  /**
   * Copies the selection in place and selects the copy, as Edit › Duplicate does.
   *
   * @returns false when there was nothing to copy.
   */
  duplicate(): Promise<boolean>;
  /** Zooms the canvas to the selection, as View › Zoom to Selection does. */
  zoomToSelection(): void;
  /** Resizes the canvas, as resizing the window does. */
  resizeCanvas(width: number, height: number): void;
  /** Sets the size, in glyph units per em, of the text the open glyph is edited in. */
  setTextSize(size: number): void;
  /** Moves the text the open glyph is edited in to a canvas position. */
  moveText(to: Point2D): void;
  /** Types into the text run, as the Text tool does. */
  typeText(text: string): Promise<void>;

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
  /** Adds a variation axis, as the Create axis menu does. */
  addAxis(axis: AxisDefinition): void;
  /**
   * Replaces the axis tagged `axis`'s own mapping curve with `points`, each an
   * input (user) value and the output (design) value it maps to, as the
   * axis mapping settings panel does.
   */
  setAxisMapping(
    axis: string,
    points: readonly (readonly [input: number, output: number])[],
  ): Promise<void>;
  /** Adds a source at `location`, as the Create source menu does; the open glyph gets a layer there. */
  addSource(name: string, location: AxisValues): void;
  /** Makes the source named `name` the one being edited, as clicking it in the Sources panel does. */
  switchToSource(name: string): void;
  /** Sets a source's metric named `metric` to `position`, as the source settings panel's metric field does. */
  setSourceMetric(source: string, metric: string, position: number): Promise<void>;
  /** Adds a named instance at `location`, as the Create instance menu does. */
  addInstance(name: string, location: AxisValues): void;

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
  /** Drags from one glyph-local position to another, as the pointer does, and waits for the edit. */
  dragAt(from: Point2D, to: Point2D, modifiers?: Modifiers): Promise<void>;
  /**
   * Presses at `from` and moves to `to` without releasing, so the edit is only
   * previewed. {@link moveHeldPointer} and {@link releasePointer} carry it on.
   */
  holdDragAt(from: Point2D, to: Point2D, modifiers?: Modifiers): void;
  /** Moves the pointer held by {@link holdDragAt}; moving to where it is samples new modifiers. */
  moveHeldPointer(to: Point2D, modifiers?: Modifiers): void;
  /**
   * Releases the pointer held by {@link holdDragAt} and waits for the edit.
   *
   * @param at - where the release lands, when the pointer moved there without
   * a move being drawn first; where it is held otherwise.
   */
  releasePointer(modifiers?: Modifiers, at?: Point2D): Promise<void>;
  /** Moves the pointer over a glyph-local position with no button held. */
  hoverAt(position: Point2D, modifiers?: Modifiers): void;
  /** Zooms the canvas to `zoom`, as the zoom controls do. */
  setZoom(zoom: number): void;
  /** Switches to the Hand for as long as Space is held, as the Space key binding does. */
  holdSpaceForHand(): void;
  /** Lets go of Space, returning from the Hand to the tool before it. */
  releaseSpace(): void;
  /** Picks the item `itemId` from a tool's toolbar menu, as the toolbar's dropdown does. */
  chooseToolMenuItem(tool: ToolName, itemId: string): void;
  /** Adds a continuous external axis to the font, as the add-axis menu does, and waits for it. */
  addAxis(tag: string, minimum: number, defaultValue: number, maximum: number): Promise<void>;
  /**
   * Adds a source at a location keyed by axis tag, as the sources panel does,
   * and waits for it. The new source becomes the active one.
   */
  addSource(name: string, location: Readonly<Record<string, number>>): Promise<void>;
  /** Deletes the source named `name`, as the sources settings panel's delete button does, and waits for it. */
  deleteSource(name: string): Promise<void>;
  /** Moves the editor to a location keyed by axis tag, as the location sliders do. */
  moveToLocation(location: Readonly<Record<string, number>>): void;
  /** Makes the source named `name` the one shown and edited, as clicking its row in the sources panel does. */
  openSource(name: string): void;
  /** Turns the comparison outline of the source named `name` on or off, as its row's toggle does. */
  toggleSourceOutline(name: string): void;
  /** Edits every source at once, or back to the active one, as the sources panel's edit-all does. */
  toggleAllSourcesForEditing(): boolean;
  /** Stops editing every source but the active one. */
  collapseEditingSources(): boolean;

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
  /** The font's info, metrics, axes, sources and instances, as agents read them. */
  fontOverview(): FontOverview;
  /** The glyph named `name`: its identity and the layer each source holds. */
  glyph(name: string): GlyphSummary;
  /** Where `location` sits in the designspace: its design location, the source exactly there, and the metrics there. */
  locationAt(location: AxisValues): ResolvedLocation;
  /** The open glyph as it draws at `location`, interpolated between sources; null when it cannot be resolved there. */
  glyphAt(location: AxisValues): Promise<ResolvedGlyph | null>;
  /**
   * Where the canvas shows each point now, including a gesture not yet
   * released. Test-only: agents read only committed geometry.
   */
  shownPointPositions(ids: readonly PointId[]): Record<PointId, Point2D>;
  /**
   * Where the faint pre-edit outline shows each point while a gesture is in
   * flight, or null when none is shown. Test-only: not agent data.
   */
  editGhost(ids: readonly PointId[]): Record<PointId, Point2D> | null;
  /** The open glyph's authored outline at the source named `source`, as agents read it. */
  outlineAt(source: string): Promise<Outline>;
  /** The id selection uses for the segment from `start` to `end`. */
  segmentBetween(start: PointId, end: PointId): string;
  /** The active tool's state, as agents read it. */
  toolState(): string | null;
  /** The cursor the active tool asks for, by name (`move`, `bend`, `nwse-resize`). Test-only. */
  toolCursor(): string;
  /** The snap guides the active tool draws, in glyph units. Test-only: not agent data. */
  snapGuides(): readonly PositionGuide[];
  /** The selection's bounds in glyph units, or null when nothing is selected. */
  selectionLocalRect(): Rect2D | null;
  /** Whether Select shows the bounding box around the selection. Test-only. */
  boundingBoxShown(): boolean;
  /** How near, in the open glyph's units, the pointer must come to hit something. */
  hitDistance(): number;
  /** How many canvas units one screen pixel spans at the current zoom. */
  pixelSize(): number;
  /** The font's metrics at the default location, as agents read them. */
  metrics(): SourceMetrics;
  /** The id of whatever the pointer hovers, or null. Test-only. */
  hoveredId(): string | null;
  /** Whether the session disables tool `name`. */
  toolDisabled(name: ToolName): boolean;
  /** How many items the text run holds. */
  textLength(): number;
  /** What kind of thing the pointer would hit at a glyph-local position (`canvas`, `point`, `segment`…). Test-only. */
  targetAt(position: Point2D): string;

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
  /** The open glyph's outline as the canvas draws it now, a gesture's uncommitted preview included. */
  drawnOutline(): Outline;
  /** The point handles the canvas draws on the open glyph, with how each is styled. */
  drawnHandles(): readonly DrawnHandle[];
  /** The source and instance outlines the canvas draws around the open glyph, in drawing order. */
  drawnOutlineTargets(): readonly GlyphOutlineTarget[];
  /** The snap guides the active tool draws for the gesture in flight, in glyph units. */
  drawnSnapGuides(): readonly PositionGuide[];
  /** The active tool and the state it is in, as agents read it. */
  toolState(): EditorTool | null;
  /** The font's metrics at the editor's location, as agents resolve them. */
  metrics(): SourceMetrics;
  /** The font's source named `name`, or null. */
  source(name: string): Source | null;
  /** How far the canvas is panned, in screen pixels. Test-only: not agent data. */
  canvasOffset(): Point2D;
  /** How far from a point, in the open glyph's units, a click still lands on it. Test-only: not agent data. */
  clickReach(): number;

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
  /** Opens the glyph named `name` in the text run, as choosing it in the glyph grid does. */
  openGlyph(name: string): Promise<void>;
  /** Adds an axis to the font, as the axes panel does. */
  addAxis(tag: string, range: { minimum: number; default: number; maximum: number }): Promise<void>;
  /** Adds a source at a location keyed by axis tag, as the sources panel does. */
  addSource(name: string, location: Readonly<Record<string, number>>): Promise<void>;
  /** Edits the sources named `names` together, as Cmd-clicking them in the sources panel does. */
  editSources(names: readonly string[]): Promise<void>;

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
