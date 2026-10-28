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
import type { GlyphOutlineTarget, PositionGuide, SourceSelectionMode } from "@shift/editor/types";
import type { ToolName } from "@shift/editor/tools";
import type { AlignmentType, DistributeType } from "@shift/editor/transform";
import type { Bounds, Point2D, Rect2D } from "@shift/geo";
import type {
  AuthoredLayer,
  EditorTool,
  EditorView,
  FontOverview,
  GlyphSummary,
  KerningToolView,
  ResolvedGlyph,
  ResolvedLocation,
  SpacingToolView,
  TextRunView,
} from "@shift/runtime";
import type {
  AnchorId,
  ComponentId,
  GlyphName,
  GlyphRecord,
  KerningPosition,
  PointId,
  SelectableId,
  Source,
  SourceMetrics,
  Unicode,
} from "@shift/types";
import type { EditorCommandId } from "@shared/commands";
import type { DrawnHandle } from "@/agent/ShiftEditorReader";
import type { WorkspaceDocumentState } from "@shared/workspace/protocol";
import type { GlyphFixture, PointNames } from "./fixtures";
import type {
  EditorReads,
  GlyphAnchor,
  KerningGroup,
  Outline,
  OutlinePoint,
  SourceKerning,
} from "./reads";

/** Keyboard modifiers held during a gesture. */
export interface Modifiers {
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
}

/** How {@link EditorTestSurface.draw} leaves the selection. */
export interface DrawOptions {
  /** Selects every point drawn, as if the test had then selected them all. */
  readonly select?: boolean;
}

/** A new continuous axis, as the Axes panel creates one. */
export interface AxisFixture {
  readonly tag: string;
  /** The axis's display name; its tag when omitted. */
  readonly name?: string;
  readonly minimum: number;
  readonly default: number;
  readonly maximum: number;
  /** Whether users see the axis; `external` when omitted. */
  readonly role?: "external" | "internal";
}

/**
 * A designspace location as each axis's user-facing value, keyed by axis tag;
 * unnamed axes sit at their default.
 */
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

// The read types tests see beyond {@link EditorReads}'s. Each aliases the
// `@shift/runtime` (or agent reader) type agents read; tests import these,
// never the runtime or `agent/`.

/** One glyph's authored layer at one source, as agents read it with `layers.get`. */
export type SourceLayer = AuthoredLayer;
/** A glyph drawn at a designspace location: its path and advance. */
export type GlyphAtLocation = ResolvedGlyph;
/** A glyph's identity and the layer each source holds. */
export type GlyphListing = GlyphSummary;
/** The font's info, metrics, axes, sources and instances. */
export type FontSummary = FontOverview;
/** A location resolved: its design coordinates, the source there, and the metrics. */
export type LocationSummary = ResolvedLocation;
/** The window's editor facts: open glyph, sources, location, selection, tool and edit state. */
export type EditorViewState = EditorView;
/** The active tool and its state. */
export type ActiveTool = EditorTool;
/** The canvas text run as it shows now. */
export type CanvasText = TextRunView;
/** What the Spacing tool shows. */
export type SpacingToolState = SpacingToolView;
/** What the Kerning tool shows. */
export type KerningToolState = KerningToolView;
/** One point handle the canvas draws, and how it is styled. */
export type CanvasHandle = DrawnHandle;

/**
 * @remarks
 * The reads come from {@link EditorReads}, which the Playwright `EditorDriver`
 * implements too. The in-process editor answers kerning and selection at
 * once, so those reads narrow to plain values here.
 */
export interface EditorTestSurface extends EditorReads {
  /**
   * Builds `fixture` into the open glyph through the editor's own commands.
   *
   * @remarks
   * The drawing is undoable like any edit: the engine keeps its own undo
   * stack, which setup cannot yet opt out of. Undo only what the test did.
   *
   * @param options - `select` selects every point drawn, in drawing order;
   * otherwise nothing is selected afterwards.
   * @returns the minted point ids, keyed by each point's `name`.
   */
  draw<const F extends GlyphFixture>(
    fixture: F,
    options?: DrawOptions,
  ): Promise<Record<PointNames<F>, PointId>>;

  /** Makes `name` the active tool. */
  selectTool(name: ToolName): void;
  /** Replaces the selection with `ids`. */
  select(ids: readonly PointId[]): void;
  /** Replaces the selection with any mix of points, contours, anchors and components. */
  selectObjects(ids: readonly SelectableId[]): void;
  /** Selects everything in the open glyph, or every glyph of the text when none is edited, as Edit › Select All does. */
  selectAll(): void;
  /** Clicks at a glyph-local position and waits for the edit it makes. */
  clickAt(position: Point2D, modifiers?: Modifiers): Promise<void>;
  /** Clicks twice at a glyph-local position and waits for the edit it makes. */
  doubleClickAt(position: Point2D, modifiers?: Modifiers): Promise<void>;
  /** Presses the pointer at a glyph-local position, starting a gesture. */
  pressAt(position: Point2D, modifiers?: Modifiers): void;
  /**
   * Moves the pointer to a glyph-local position, as moving the mouse over the
   * canvas does, and lets the move be handled. With no button pressed this hovers.
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
   * Starts dragging from one glyph-local position to another and holds it
   * before release, so the edit is only previewed. {@link movePointerTo} and
   * {@link releaseAt} carry it on.
   */
  holdDragFrom(from: Point2D, to: Point2D, modifiers?: Modifiers): void;
  /** Drags point `id` by `by` in glyph units, as the pointer does, and waits for the edit. */
  dragPoint(id: PointId, by: Point2D, modifiers?: Modifiers): Promise<void>;
  /** Starts dragging point `id` by `by` and holds it before release, so the edit is only previewed. */
  holdDrag(id: PointId, by: Point2D, modifiers?: Modifiers): void;
  /** Drags anchor `id` by `by` in glyph units, as the pointer does, and waits for the edit. */
  dragAnchor(id: AnchorId, by: Point2D, modifiers?: Modifiers): Promise<void>;
  /** Starts dragging anchor `id` by `by` and holds it before release, so the edit is only previewed. */
  holdDragAnchor(id: AnchorId, by: Point2D, modifiers?: Modifiers): void;
  /** Abandons the gesture in flight, as losing pointer capture does. */
  cancelGesture(): void;
  /** Presses a key and waits for the edit it makes. */
  pressKey(key: string, modifiers?: Modifiers): Promise<void>;
  /** Switches to the Hand for as long as Space is held, as the Space key binding does. */
  holdSpaceForHand(): void;
  /** Lets go of Space, returning from the Hand to the tool before it. */
  releaseSpace(): void;
  /** Picks the item `itemId` from a tool's toolbar menu, as the toolbar's dropdown does. */
  chooseToolMenuItem(tool: ToolName, itemId: string): void;
  /**
   * Runs an app command, as its menu item or shortcut does, and waits for the edit.
   *
   * @returns false when the command does not apply to the selection.
   */
  runCommand(id: EditorCommandId): Promise<boolean>;

  /**
   * Deletes the selection, as Edit › Delete does.
   *
   * @param mode - `"fit"` joins the neighbours with a fitted curve; `"gap"` opens the contour.
   */
  deleteSelection(mode?: DeleteMode): Promise<boolean>;
  /**
   * Copies the selection in place and selects the copy, as Edit › Duplicate does.
   *
   * @returns false when there was nothing to copy.
   */
  duplicate(): Promise<boolean>;
  /** Copies the selection, as Edit › Copy does. */
  copy(): Promise<boolean>;
  /** Cuts the selection, as Edit › Cut does. */
  cut(): Promise<boolean>;
  /** Pastes the clipboard into the open glyph, as Edit › Paste does. */
  paste(): Promise<boolean>;
  /** Combines the two selected closed contours, as the sidebar's boolean buttons do. */
  combineSelectedContours(operation: "union" | "intersect" | "subtract"): Promise<boolean>;
  /** Reverses the contours the selection touches, as the canvas menu's Reverse Contour does. */
  reverseSelectedContour(): Promise<boolean>;
  /** Aligns the selected points to an edge or center of their bounds, as the sidebar's align buttons do. */
  alignSelection(alignment: AlignmentType): boolean;
  /** Spaces the selected points evenly, as the sidebar's distribute buttons do. */
  distributeSelection(type: DistributeType): boolean;
  /** Mirrors the selection across its center, as the sidebar's flip buttons do. */
  flipSelection(axis: "horizontal" | "vertical"): boolean;
  /** Rotates the selection about its center, as the sidebar's rotation field does. */
  rotateSelection(degrees: number): boolean;
  /** Sets the open glyph's advance width, as the sidebar's width field does. */
  setAdvanceWidth(width: number): void;
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

  /** Opens the glyph named `name` on the canvas, as choosing it in the glyph grid does. */
  openGlyph(name: string): Promise<void>;
  /** Renames a glyph and sets its Unicode values, as the glyph name field does. */
  setGlyphIdentity(name: string, newName: string, unicodes: readonly number[]): void;
  /** Creates one glyph per code point, named from Unicode, as the glyph grid's add action does. */
  createGlyphsForUnicodes(unicodes: readonly Unicode[]): GlyphRecord[];
  /** Sets the languages the font tracks, as the font info panel does. */
  setLanguages(ids: readonly string[]): void;

  /** Resizes the canvas, in screen pixels, as resizing the window does. */
  resizeCanvas(width: number, height: number): void;
  /** Sets the zoom level around the viewport centre, as the zoom controls do. */
  setZoom(zoom: number): void;
  /** Frames all content, as View › Zoom to Fit does. */
  zoomToFit(): void;
  /** Frames the selection, as View › Zoom to Selection does. */
  zoomToSelection(): void;
  /** Frames the open glyph's metrics box, as opening a glyph does. */
  frameGlyph(): void;
  /** Sets the size, in glyph units per em, of the text the open glyph is edited in. */
  setTextSize(size: number): void;
  /** Moves the text the open glyph is edited in to a canvas position. */
  moveText(to: Point2D): void;

  /** Types `text` at the caret in Text mode, as the keyboard does; `"\n"` is Enter. */
  typeText(text: string): void;
  /** Pastes `text` at the caret in Text mode, where `/name` picks the glyph named `name`. */
  pasteText(text: string): void;
  /**
   * Moves the caret, as the arrow keys do: by character, by word with Option,
   * or to the line end with Command. `extend` is Shift, extending the selection.
   */
  moveCaret(direction: -1 | 1, by?: "character" | "word" | "line", extend?: boolean): void;
  /** Moves the caret a line up or down, as the up and down arrows do. */
  moveCaretLine(direction: -1 | 1, extend?: boolean): void;
  /** Deletes the selected text or the character before the caret, as Backspace does. */
  deleteBackward(): void;
  /** Deletes the selected text or the character after the caret, as Delete does. */
  deleteForward(): void;
  /** Selects all the text in Text mode, as Command-A does there. */
  selectAllText(): void;
  /** Sets the sidebearing whose value field the Spacing tool has open, as typing into it does. */
  typeSidebearing(value: number): void;
  /** Switches the Spacing tool's open value field to the gap's other sidebearing. */
  switchSidebearingSide(): void;
  /** Closes the Spacing tool's open value field, as its close button does. */
  closeSidebearingField(): void;
  /** Sets the kern whose value field the Kerning tool has open, as typing into it does. */
  typeKerning(value: number): void;
  /**
   * Toggles the lock on one side of the selected kern, as the sidebar's lock
   * does: a locked side is an exception to its group at the active source.
   *
   * @returns false when that side cannot be toggled.
   */
  toggleKerningLock(side: KerningPosition): boolean;

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

  /** Adds a variation axis, as the Create axis menu does, and waits for it. */
  addAxis(axis: AxisFixture): Promise<void>;
  /**
   * Replaces the axis tagged `axis`'s own mapping curve with `points`, each an
   * input (user) value and the output (design) value it maps to, as the
   * axis mapping settings panel does.
   */
  setAxisMapping(
    axis: string,
    points: readonly (readonly [input: number, output: number])[],
  ): Promise<void>;
  /**
   * Adds a source at `location`, as the Create source menu does, and waits for
   * it. The new source becomes the active one, and the open glyph gets a layer there.
   */
  addSource(name: string, location: AxisLocation): Promise<void>;
  /** Deletes the source named `name`, as the sources settings panel's delete button does, and waits for it. */
  deleteSource(name: string): Promise<void>;
  /** Sets a source's metric named `metric` to `position`, as the source settings panel's metric field does. */
  setSourceMetric(source: string, metric: string, position: number): Promise<void>;
  /** Adds a named instance at `location`, as the Create instance menu does. */
  addInstance(name: string, location: AxisLocation): void;
  /**
   * Clicks the source named `name` in the Sources panel: alone it becomes the
   * active source; Shift (`range`) and Command (`toggle`) change which sources
   * an edit applies to.
   */
  clickSource(name: string, mode?: SourceSelectionMode): void;
  /**
   * Selects sources for editing, as clicking and Command-clicking rows in the
   * Sources panel does: the first becomes the active source, and edits apply
   * to all of them once their layers match.
   */
  editSources(names: readonly string[]): Promise<void>;
  /** Edits every source at once, or back to the active one, as the sources panel's edit-all does. */
  toggleAllSourcesForEditing(): boolean;
  /** Stops editing every source but the active one. */
  collapseEditingSources(): boolean;
  /** Turns the comparison outline of the source named `name` on or off, as its row's toggle does. */
  toggleSourceOutline(name: string): void;
  /** Moves to a location, as the axis sliders do; an exact source there becomes active. */
  setLocation(location: AxisLocation): void;

  /** The open glyph's point at a position in the active source, or null. */
  pointAt(position: Point2D): Promise<OutlinePoint | null>;
  /** The open glyph's anchor named `name` in the active source, or null. */
  anchorNamed(name: string): Promise<GlyphAnchor | null>;
  /** The open glyph's outline bounds, as agents read them; null when it has no outline. */
  outlineBounds(): Promise<Bounds | null>;
  /** The open glyph's authored layer at the source named `source`, as agents read it. */
  layerAt(source: string): Promise<SourceLayer>;
  /** The open glyph as it draws at `location`, interpolated between sources; null when it cannot be resolved there. */
  glyphAt(location: AxisLocation): Promise<GlyphAtLocation | null>;
  /** The glyph named `name`: its identity and the layer each source holds; null when the font has none. */
  glyphNamed(name: string): GlyphListing | null;
  /** The font's info, metrics, axes, sources and instances, as agents read them. */
  fontOverview(): FontSummary;
  /** The font's source named `name`, or null. */
  source(name: string): Source | null;
  /** The languages the font tracks; null when none were ever set. Test-only: not agent data yet. */
  languages(): readonly string[] | null;
  /** The current location resolved: its design coordinates, the source there, and the metrics. */
  location(): LocationSummary;
  /** Where `location` sits in the designspace: its design location, the source exactly there, and the metrics there. */
  locationAt(location: AxisLocation): LocationSummary;
  /** The font's metrics at the editor's location, as agents resolve them. */
  metrics(): SourceMetrics;
  /** The kerning between two glyphs at every source, in font source order. */
  kerning(first: string, second: string): readonly SourceKerning[];
  /** The kerning between two glyphs at the source named `source`. */
  kerningAt(source: string, first: string, second: string): SourceKerning;
  /** The kerning groups at a position, in name order. */
  kerningGroups(position: KerningPosition): readonly KerningGroup[];
  /** The kerning group named `name` at a position, or null. */
  kerningGroup(position: KerningPosition, name: string): KerningGroup | null;
  /** The kerning group the glyph named `glyph` belongs to at a position, or null. */
  kerningGroupOf(position: KerningPosition, glyph: string): KerningGroup | null;

  /** The shown glyph, source, location, editing sources, selection and tool, as agents read them. */
  editorView(): EditorViewState;
  /** The selected ids, in selection order. */
  selectionIds(): readonly string[];
  /** The active tool and the state it is in, as agents read it. */
  toolState(): ActiveTool | null;
  /** The canvas text as it shows now: items, placed glyphs, and caret; null when there is none. */
  canvasText(): CanvasText | null;
  /** What the Spacing tool shows; null when it is not active. */
  spacingTool(): SpacingToolState | null;
  /** What the Kerning tool shows; null when it is not active. */
  kerningTool(): KerningToolState | null;
  /** The open glyph's outline as the canvas draws it now, a gesture's uncommitted preview included. */
  drawnOutline(): Outline;
  /** The point handles the canvas draws on the open glyph, with how each is styled. */
  drawnHandles(): readonly CanvasHandle[];
  /** The source and instance outlines the canvas draws around the open glyph, in drawing order. */
  drawnOutlineTargets(): readonly GlyphOutlineTarget[];
  /** The snap guides the active tool draws for the gesture in flight, in glyph units. */
  drawnSnapGuides(): readonly PositionGuide[];
  /**
   * Where the canvas shows each point now, including a gesture not yet
   * released, as {@link drawnOutline} draws them.
   */
  shownPointPositions(ids: readonly PointId[]): Record<PointId, Point2D>;
  /**
   * Where the faint pre-edit outline shows each point while a gesture is in
   * flight, or null when none is shown. Test-only: not agent data.
   */
  editGhost(ids: readonly PointId[]): Record<PointId, Point2D> | null;
  /** A glyph as the canvas draws it at the current location; the open glyph when `glyph` is omitted. Test-only. */
  drawnGlyph(glyph?: string): Promise<DrawnGlyph>;
  /** The id selection uses for the segment from `start` to `end`. */
  segmentBetween(start: PointId, end: PointId): string;
  /** The selection's bounds in glyph units, or null when nothing is selected. */
  selectionLocalRect(): Rect2D | null;
  /** Where the selection's box is drawn, in canvas units. Test-only: not agent data. */
  selectionBox(): Bounds | null;
  /** Whether Select shows the bounding box around the selection. Test-only. */
  boundingBoxShown(): boolean;
  /** Whether the selected components are anchored, as the sidebar's anchoring toggle shows; null without components selected. */
  selectedComponentsAnchored(): boolean | null;
  /** Whether Decompose Components applies to the selection. */
  canDecomposeSelection(): boolean;
  /** Whether the session disables tool `name`. */
  toolDisabled(name: ToolName): boolean;
  /** The CSS cursor the editor shows. Test-only: not agent data. */
  shownCursor(): string;
  /** The cursor the active tool asks for, by name (`move`, `bend`, `nwse-resize`). Test-only. */
  toolCursor(): string;
  /** The id of whatever the pointer hovers, or null. Test-only. */
  hoveredId(): string | null;
  /** What kind of thing the pointer would hit at a glyph-local position (`canvas`, `point`, `segment`…). Test-only. */
  targetAt(position: Point2D): string;
  /** How near, in the open glyph's units, the pointer must come to hit something. Test-only: not agent data. */
  hitDistance(): number;
  /** How many canvas units one screen pixel spans at the current zoom. Test-only. */
  pixelSize(): number;
  /** The zoom level. Test-only: not agent data. */
  zoomLevel(): number;
  /** How far the canvas is panned, in screen pixels. Test-only: not agent data. */
  canvasOffset(): Point2D;
  /** Where a glyph-local position shows in the viewport, in screen pixels. Test-only: not agent data. */
  screenPosition(position: Point2D): Point2D;
  /** The viewport's centre, in screen pixels. Test-only: not agent data. */
  viewportCentre(): Point2D;
  /** Flushes pending edits and reads the document's save state. Test-only: not agent data. */
  documentState(): Promise<WorkspaceDocumentState | null>;

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
