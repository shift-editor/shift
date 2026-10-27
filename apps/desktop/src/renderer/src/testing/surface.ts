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
 * Every method is named for something a user does or sees. When a test needs
 * something not here, add a method in those terms, never one that forwards an
 * internal. {@link EditorTestSurface.asEditor} is the one escape hatch, and
 * lint allows it only as a call argument, for code under test that takes an
 * `Editor`.
 */
import type { DeleteMode, Editor } from "@shift/editor";
import type { ToolName } from "@shift/editor/tools";
import type { Point2D } from "@shift/geo";
import type { KerningPosition, PointId, PointType } from "@shift/types";
import type { WorkspaceDocumentState } from "@shared/workspace/protocol";
import type { GlyphFixture, PointNames } from "./fixtures";

/** Keyboard modifiers held during a gesture. */
export interface Modifiers {
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
}

/** One authored point, as the open glyph's layer stores it. */
export interface OutlinePoint {
  readonly id: PointId;
  readonly x: number;
  readonly y: number;
  readonly type: PointType;
  readonly smooth: boolean;
}

/** One authored contour. */
export interface OutlineContour {
  readonly closed: boolean;
  readonly points: readonly OutlinePoint[];
}

/** The open glyph's authored contours, in order. */
export type Outline = readonly OutlineContour[];

/**
 * Which kind of authored pair applies between two glyphs, as `@shift/runtime`'s
 * `KerningRule` names it: both sides glyphs, a glyph against a group (an
 * exception), both sides groups, or no pair.
 */
export type KerningRule = "glyph" | "exception" | "group" | "none";

/** The kerning between two glyphs at one source, as `@shift/runtime`'s `KerningMasterValue`. */
export interface SourceKerning {
  /** The source's name. */
  readonly source: string;
  /** Font units the pair kerns at that source. */
  readonly amount: number;
  readonly rule: KerningRule;
}

/** One kerning group, as `@shift/runtime`'s `KerningGroupSummary`. */
export interface KerningGroup {
  readonly name: string;
  readonly position: KerningPosition;
  /** Member glyph names, in group order. */
  readonly members: readonly string[];
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

  /** The open glyph's authored outline. */
  outline(): Outline;
  /** One authored point of the open glyph, or null when it has none with that id. */
  point(id: PointId): OutlinePoint | null;
  /** The open glyph's anchors, in order. */
  anchors(): readonly { readonly name: string; readonly x: number; readonly y: number }[];
  /** The open glyph's components: each base glyph's name and offset. */
  components(): readonly { readonly glyph: string; readonly x: number; readonly y: number }[];
  /** Where each point is now, as the open glyph's layer stores it. */
  pointPositions(ids: readonly PointId[]): Record<PointId, Point2D>;
  /** The open glyph's advance width. */
  advanceWidth(): number;
  /** The kerning between two glyphs at every source, in font source order, as shown now. */
  kerning(first: string, second: string): readonly SourceKerning[];
  /** The kerning between two glyphs at one source, as shown now; null when the font has no such source. */
  kerningAt(source: string, first: string, second: string): SourceKerning | null;
  /** The kerning groups at a position, in the order the kerning panel lists them. */
  kerningGroups(position: KerningPosition): readonly KerningGroup[];
  /** The kerning group named `name` at a position, or null. */
  kerningGroup(position: KerningPosition, name: string): KerningGroup | null;
  /** The kerning group `glyph` belongs to at a position, or null. */
  kerningGroupOf(position: KerningPosition, glyph: string): KerningGroup | null;
  /** The selected ids, in selection order. */
  selectionIds(): readonly string[];
  /** The CSS cursor the editor shows. */
  shownCursor(): string;
  /** Flushes pending edits and reads the document's save state. */
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
