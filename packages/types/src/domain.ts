/**
 * Domain types — deeply readonly wrappers over generated Rust snapshot types.
 *
 * The generated types in `./generated/` (produced by `ts-rs` from Rust structs)
 * are mutable and use mutable arrays. The domain layer re-exports them as
 * deeply frozen views so that the app never accidentally mutates font engine
 * state. Field names and shapes are identical to the generated types; only
 * mutability is removed.
 *
 * Use these types everywhere in the renderer and tool layers. The generated
 * types should only be referenced inside this file and in the NAPI bridge.
 *
 * @module
 */
import type {
  GlyphSnapshot,
  ContourSnapshot,
  PointSnapshot,
  AnchorSnapshot,
  RenderPointSnapshot,
  RenderContourSnapshot,
  DecomposedTransform as DecomposedTransformGenerated,
  Source as SourceGenerated,
} from "./generated";

/**
 * An anchor or control point. Immutable view of {@link PointSnapshot}.
 * The `isSmooth` flag indicates G2 (tangent-continuous) Bezier continuity:
 * when true, the two control handles are constrained to be collinear through
 * the anchor.
 */
export type Point = Readonly<PointSnapshot>;

/** A named glyph attachment anchor. Immutable view of {@link AnchorSnapshot}. */
export type Anchor = Readonly<AnchorSnapshot>;

/** A render-only point used in flattened composite contours. */
export type RenderPoint = Readonly<RenderPointSnapshot>;

/** Decomposed affine transform (translate, rotate, scale, skew). Immutable view. */
export type DecomposedTransform = Readonly<DecomposedTransformGenerated>;

/**
 * A single contour (open or closed path) with its points frozen.
 * Open contours have distinct start/end anchors (used by the Pen tool to
 * extend or close the path). Closed contours loop back to the first point.
 * Wraps {@link ContourSnapshot} with a `readonly` point array of {@link Point}.
 */
export type Contour = Readonly<Omit<ContourSnapshot, "points">> & {
  readonly points: readonly Point[];
};

/** A render-only contour produced by flattening component references. */
export type RenderContour = Readonly<Omit<RenderContourSnapshot, "points">> & {
  readonly points: readonly RenderPoint[];
};

/**
 * A full glyph with all contours and their points frozen.
 * Contours are ordered by creation time (newest last). The order is
 * significant for rendering (later contours draw on top) and for
 * hit-testing priority.
 * Wraps {@link GlyphSnapshot} with a `readonly` contour array of {@link Contour}.
 */
export type Glyph = Readonly<Omit<GlyphSnapshot, "contours" | "anchors" | "compositeContours">> & {
  readonly contours: readonly Contour[];
  readonly anchors: readonly Anchor[];
};

/** A single component of a composite glyph. */
export type CompositeComponent = {
  readonly componentGlyphName: string;
  readonly sourceUnicodes: readonly number[];
  readonly contours: readonly RenderContour[];
};

/** Composite glyph data — the component breakdown of a composite/reference glyph. */
export type CompositeGlyph = {
  readonly glyphName: string;
  readonly components: readonly CompositeComponent[];
};

/**
 * A designspace location keyed by axis tag.
 *
 * The generated `Location` type marshals from Rust as `HashMap<String, f64>`,
 * which gives optional values per key. In the renderer we always populate
 * every active axis, so the domain shape is a non-optional record.
 * Conversion happens once, inside `NativeBridge`; everything downstream uses
 * `AxisLocation`.
 */
export type AxisLocation = Record<string, number>;

/**
 * A source/master with its location resolved against the font's axes.
 * Wraps the generated `Source` but replaces its `Location` field with
 * {@link AxisLocation}.
 */
export type Source = Readonly<Omit<SourceGenerated, "location">> & {
  readonly location: AxisLocation;
};
