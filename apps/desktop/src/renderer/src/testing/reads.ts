/**
 * The reads both test drivers answer: the in-process {@link EditorTestSurface}
 * in vitest and the app's `EditorDriver` in Playwright.
 *
 * @remarks
 * Every read is the agent read API (`@shift/runtime`): vitest calls the
 * window's agent readers in-process, and Playwright reaches the same readers
 * through the app's local MCP server. Both drivers implement this interface,
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

/**
 * The open glyph's authored contours, as `@shift/runtime`'s `layers.get`
 * returns them to agents.
 */
export type Outline = readonly AuthoredContour[];

export interface EditorReads {
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
  kerning(first: string, second: string): Read<readonly KerningMasterValue[]>;
  /** The kerning between two glyphs at the source named `source`; null when the font has none. */
  kerningAt(source: string, first: string, second: string): Read<KerningMasterValue | null>;
  /** The kerning groups at a position, in name order. */
  kerningGroups(position: KerningPosition): Read<readonly KerningGroupSummary[]>;
  /** The kerning group named `name` at a position, or null. */
  kerningGroup(position: KerningPosition, name: string): Read<KerningGroupSummary | null>;
  /** The kerning group the glyph named `glyph` belongs to at a position, or null. */
  kerningGroupOf(position: KerningPosition, glyph: string): Read<KerningGroupSummary | null>;
  /** The selected ids, in selection order. */
  selectionIds(): Read<readonly string[]>;
}
