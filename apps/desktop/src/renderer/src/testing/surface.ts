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
import type { Editor } from "@shift/editor";
import type { ToolName } from "@shift/editor/tools";
import type { Point2D } from "@shift/geo";
import type { PointId, PointType } from "@shift/types";
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
  /** Deletes the selection, as Edit › Delete does. */
  deleteSelection(): Promise<boolean>;

  /** The open glyph's authored outline. */
  outline(): Outline;
  /** The open glyph's anchors, in order. */
  anchors(): readonly { readonly name: string; readonly x: number; readonly y: number }[];
  /** The open glyph's components: each base glyph's name and offset. */
  components(): readonly { readonly glyph: string; readonly x: number; readonly y: number }[];
  /** Where each point is now, as the open glyph's layer stores it. */
  pointPositions(ids: readonly PointId[]): Record<PointId, Point2D>;
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
   * Saves the document to a temporary file and opens it in a new editor on the
   * same glyph. Close the returned editor with {@link close}.
   */
  reopen(): Promise<EditorTestSurface>;
  /** Closes the document without saving and disposes the editor. */
  close(): Promise<void>;

  /** The editor itself, only to pass to code under test that takes an `Editor`. */
  asEditor(): Editor;
}
