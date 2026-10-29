/**
 * The reads both test drivers answer: the in-process {@link EditorTestSurface}
 * in vitest and the app's `EditorDriver` in Playwright.
 *
 * @remarks
 * Every read is the agent read API (`@shift/runtime`): vitest calls the
 * window's app readers in-process, and Playwright calls the same readers,
 * with the same methods and selectors, through the app's E2E read hook.
 * Both drivers implement this interface,
 * so a read cannot exist in one without the other. A read returns either a
 * value or a promise of one ({@link Read}); `await` it and the test runs
 * against either driver.
 *
 * This file imports types only, so `apps/desktop/e2e` can import it.
 */
import type {
  AuthoredAnchor,
  AuthoredComponent,
  AuthoredContour,
  AuthoredLayer,
  AuthoredPoint,
  DocumentState,
  EditorView,
  FontOverview,
  GlyphSummary,
  KerningGroupSummary,
  KerningMasterValue,
  ResolvedLocation,
  SourceSelector,
  SpacingToolView,
  TextRunView,
} from "@shift/runtime";
import type {
  Axis,
  AxisId,
  KerningPosition,
  NamedInstance,
  NamedInstanceId,
  PointId,
  Source,
  SourceId,
} from "@shift/types";
import type { GlyphOutlineTarget, SourceSelectionMode } from "@shift/editor/types";
import type { DrawnHandle } from "@/agent/ShiftEditorReader";

/**
 * A read's result: the in-process editor may answer at once, the running app
 * answers after a round trip.
 */
export type Read<T> = T | Promise<T>;

// The read types tests see. Each aliases the `@shift/runtime` type agents
// read, so tests import these and never the runtime: a test then survives the
// agent API moving or renaming its types while the data holds.

/** One authored point of the open glyph, nested in its contour. */
export type OutlinePoint = AuthoredPoint;
/** One authored contour of the open glyph and its ordered points. */
export type OutlineContour = AuthoredContour;
/** The open glyph's authored contours, as agents read them with `layers.get`. */
export type Outline = readonly OutlineContour[];
/** One authored anchor of the open glyph. */
export type GlyphAnchor = AuthoredAnchor;
/** One component the open glyph places, with its base glyph and transformation. */
export type GlyphComponent = AuthoredComponent;
/** The kerning between two glyphs at one source: its amount, origin and the pair that applies. */
export type SourceKerning = KerningMasterValue;
/** One kerning group at a pair position and its member glyphs. */
export type KerningGroup = KerningGroupSummary;
/** One glyph's authored layer at one source, as agents read it with `layers.get`. */
export type SourceLayer = AuthoredLayer;
/** A source by its exact name or stable id, the font's default source, or the editor's active one. */
export type SourceSelection = { name: string } | { id: SourceId } | "default" | "active";
/** A named instance by its exact name or stable id. */
export type InstanceSelection = { name: string } | { id: NamedInstanceId };
/** An axis by its tag or stable id. */
export type AxisSelection = { tag: string } | { id: AxisId };

/** A glyph's identity and the layer each source holds. */
export type GlyphListing = GlyphSummary;
/** The font's info, metrics, axes, sources and instances. */
export type FontSummary = FontOverview;
/** A location resolved: its design coordinates, the source there, and the metrics. */
export type LocationSummary = ResolvedLocation;
/** The window's editor facts: open glyph, sources, location, selection, tool and edit state. */
export type EditorViewState = EditorView;
/** The window's document and whether it has edits Save has not written. */
export type DocumentSaveState = DocumentState;
/** The canvas text run as it shows now. */
export type CanvasText = TextRunView;
/** What the Spacing tool shows. */
export type SpacingToolState = SpacingToolView;
/** One point handle the canvas draws, and how it is styled. */
export type CanvasHandle = DrawnHandle;
/** A source or instance outline the canvas draws around the open glyph for comparison. */
export type OutlineTarget = GlyphOutlineTarget;

/** Where a point read looks for the point. */
/** Where {@link EditorTestSurface.anchorNamed} reads. */
export interface AnchorReadOptions {
  /** The source, by name, whose layer of the open glyph to read; the shown one when omitted. */
  readonly source?: string;
}

export interface PointReadOptions {
  /**
   * Read the counterpart of the shown source's point `id` in this source's
   * layer of the open glyph, as the engine matches the two layers.
   */
  readonly source?: SourceSelector;
}

export interface EditorReads {
  /** The open glyph's authored outline, as agents read it. */
  outline(): Promise<Outline>;
  /**
   * One authored point of the open glyph at the shown source, or null when it
   * has none with that id.
   *
   * @param options - with `source`, the point's counterpart in that source's
   * layer instead; null when the two layers do not match completely or `id`
   * has no counterpart there.
   */
  point(id: PointId, options?: PointReadOptions): Promise<OutlinePoint | null>;
  /** The open glyph's anchors, in order. */
  anchors(): Promise<readonly GlyphAnchor[]>;
  /** The open glyph's components, in order. */
  components(): Promise<readonly GlyphComponent[]>;
  /** The open glyph's advance width. */
  advanceWidth(): Promise<number>;
  /** The kerning between two glyphs at every source, in font source order. */
  kerning(first: string, second: string): Read<readonly SourceKerning[]>;
  /** The kerning between two glyphs at the source named `source`. */
  kerningAt(source: string, first: string, second: string): Read<SourceKerning>;
  /** The kerning groups at a position, in name order. */
  kerningGroups(position: KerningPosition): Read<readonly KerningGroup[]>;
  /** The kerning group named `name` at a position, or null. */
  kerningGroup(position: KerningPosition, name: string): Read<KerningGroup | null>;
  /** The kerning group the glyph named `glyph` belongs to at a position, or null. */
  kerningGroupOf(position: KerningPosition, glyph: string): Read<KerningGroup | null>;
  /** The selected ids, in selection order. */
  selectionIds(): Read<readonly string[]>;
  /** Every glyph's name, in font directory order, as agents page through `glyphs.list`. */
  glyphNames(): Promise<readonly string[]>;
  /** The glyph named `name`: its identity and the layer each source holds; null when the font has none. */
  glyphNamed(name: string): Read<GlyphListing | null>;
  /** The authored layer of the glyph named `glyph` at the source named `source`, the default source when omitted. */
  layerOf(glyph: string, source?: string): Promise<SourceLayer>;
  /**
   * The source `selector` names: by name or id, the font's default source (`"default"`), or the
   * one the editor shows and edits (`"active"`, null between sources); null when it has none.
   */
  source(selector: SourceSelection): Read<Source | null>;
  /** The font's named instance by name or id, or null when it has none. */
  instance(selector: InstanceSelection): Read<NamedInstance | null>;
  /** The font's axis by tag or id, or null when it has none. */
  axis(selector: AxisSelection): Read<Axis | null>;
  /** The font's info, metrics, axes, sources and instances, and the session's mode, as agents read them. */
  fontOverview(): Read<FontSummary>;
  /** The shown glyph, source, location, editing sources, selection and tool, as agents read them. */
  editorView(): Read<EditorViewState>;
  /** The editor's location resolved: its design coordinates, the source there, and the metrics. */
  location(): Read<LocationSummary>;
  /** The document's save state behind every edit made so far; null for a session without a document. */
  documentState(): Promise<DocumentSaveState | null>;
  /** The canvas text as it shows now: items, placed glyphs, and caret; null when there is none. */
  canvasText(): Read<CanvasText | null>;
  /** What the Spacing tool shows; null when it is not active. */
  spacingTool(): Read<SpacingToolState | null>;
  /** The point handles the canvas draws on the open glyph, with how each is styled. */
  drawnHandles(): Read<readonly CanvasHandle[]>;
  /** The source and instance outlines the canvas draws around the open glyph, in drawing order. */
  drawnOutlineTargets(): Read<readonly OutlineTarget[]>;
}

/** What both drivers do the way a user does it, under the same names. */
export interface EditorActions {
  /**
   * Shows and edits the source named `name`, as clicking its row in the Sources panel does;
   * `toggle` adds it to (or removes it from) the sources being edited, as Cmd-clicking does.
   */
  clickSource(name: string, mode?: SourceSelectionMode): Read<void>;
}
