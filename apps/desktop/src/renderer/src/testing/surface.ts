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
import type { Point2D } from "@shift/geo";
import type {
  AuthoredAnchor,
  AuthoredComponent,
  AuthoredContour,
  AuthoredPoint,
  EditorTool,
  KerningGroupSummary,
  KerningMasterValue,
} from "@shift/runtime";
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
