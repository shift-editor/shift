/**
 * The reads both test drivers answer: the in-process {@link EditorTestSurface}
 * in vitest and the app's `EditorDriver` in Playwright.
 *
 * @remarks
 * Every read is the agent read API (`@shift/runtime`): vitest calls the
 * window's agent readers in-process, and Playwright calls the same readers,
 * with the same methods and selectors, through the app's E2E read hook.
 * Both drivers implement this interface,
 * so a read cannot exist in one without the other. A read returns either a
 * value or a promise of one ({@link Read}); `await` it and the test runs
 * against either driver.
 *
 * This file imports types only, so `apps/desktop/e2e` can import it.
 */
import type { Point2D } from "@shift/geo";
import type {
  AuthoredAnchor,
  AuthoredComponent,
  AuthoredContour,
  AuthoredPoint,
  KerningGroupSummary,
  KerningMasterValue,
} from "@shift/runtime";
import type { KerningPosition, PointId } from "@shift/types";

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

export interface EditorReads {
  /** The open glyph's authored outline, as agents read it. */
  outline(): Promise<Outline>;
  /** One authored point of the open glyph, or null when it has none with that id. */
  point(id: PointId): Promise<OutlinePoint | null>;
  /** The open glyph's anchors, in order. */
  anchors(): Promise<readonly GlyphAnchor[]>;
  /** The open glyph's components, in order. */
  components(): Promise<readonly GlyphComponent[]>;
  /** Where each point is now, as the open glyph's authored layer stores it. */
  pointPositions(ids: readonly PointId[]): Promise<Record<PointId, Point2D>>;
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
}
