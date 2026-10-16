import type { MatModel } from "@shift/geo";

/** A named anchor position in a glyph's own coordinates. */
export interface PropagationAnchor {
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

/** One component of a composite, as propagation reads it. */
export interface PropagationComponent {
  /** The component glyph's anchors after its own propagation; null when the glyph is missing. */
  readonly anchors: readonly PropagationAnchor[] | null;
  /** How many base glyphs the component glyph counts, for numbering ligature anchors. */
  readonly baseGlyphCount: number;
  /** Where the component sits in the composite. */
  readonly matrix: MatModel;
}

/** A glyph's own anchors and components, and the category facts propagation reads. */
export interface PropagationGlyph {
  readonly anchors: readonly PropagationAnchor[];
  readonly components: readonly PropagationComponent[];
  /** A mark that has anchors keeps exactly its own. */
  readonly isMark: boolean;
  /** A ligature numbers its components' anchors: `top` becomes `top_1`, `top_2`. */
  readonly isLigature: boolean;
}

export interface PropagatedAnchors {
  readonly anchors: readonly PropagationAnchor[];
  /** How many base glyphs this glyph counts, for composites built on it. */
  readonly baseGlyphCount: number;
}

/**
 * Returns a glyph's anchors with its components' anchors copied in, as
 * Glyphs.app does and fontc compiles.
 *
 * @remarks
 * A port of fontc's `anchors_traversing_components` (fontir 1.0), itself a
 * port of Glyphs.app's behaviour, kept line for line so export and the
 * editor agree; tests compare the two on real fonts. Each component's
 * anchors move with it; a mark component's `_name` anchor is dropped and its
 * own `name` anchor replaces the base's, so marks stack; a flipped component
 * swaps `top`/`bottom`, `left`/`right`, and `entry`/`exit`; ligature
 * components number their anchors; a glyph's own anchors win over copied
 * ones; and an `*origin` anchor shifts the glyph's own anchors.
 *
 * Components must already be propagated: callers recurse into component
 * glyphs first.
 */
export function propagateAnchors(glyph: PropagationGlyph): PropagatedAnchors {
  const own = glyph.anchors;
  if (own.length === 0 && glyph.components.length === 0) {
    return { anchors: [], baseGlyphCount: 0 };
  }
  // A mark with anchors keeps them, whatever its components carry.
  if (own.length > 0 && glyph.isMark) {
    return { anchors: originAdjusted(own), baseGlyphCount: 0 };
  }

  let hasUnderscore = own.some((anchor) => anchor.name.startsWith("_"));
  let baseGlyphCount = 0;
  // Insertion-ordered, and replacing a name keeps its place, as Rust's IndexMap does.
  const all = new Map<string, PropagationAnchor>();

  for (const [index, component] of glyph.components.entries()) {
    const anchors = component.anchors;
    if (!anchors) continue;

    const combHasUnderscore = anchors.some(
      (anchor) => anchor.name.length >= 2 && anchor.name.startsWith("_"),
    );
    const combHasExit = anchors.some((anchor) => anchor.name.startsWith("exit"));
    if (!(combHasUnderscore || combHasExit)) {
      // A glyph has one exit, at its end: drop exits taken from earlier components.
      for (const name of all.keys()) if (name.startsWith("exit")) all.delete(name);
    }

    const scale = xyScale(component.matrix);
    for (const anchor of anchors) {
      const newHasUnderscore = anchor.name.startsWith("_");
      if ((index > 0 || hasUnderscore) && newHasUnderscore) continue;
      if (index > 0 && anchor.name.startsWith("entry")) continue;

      let name = renameForScale(anchor.name, scale);
      if (
        glyph.isLigature &&
        component.baseGlyphCount > 0 &&
        !newHasUnderscore &&
        !(name.startsWith("exit") || name.startsWith("entry"))
      ) {
        name = ligatureAnchorName(name, baseGlyphCount);
      }

      all.set(name, { name, ...transformed(anchor, component.matrix) });
      hasUnderscore ||= newHasUnderscore;
    }
    baseGlyphCount += component.baseGlyphCount;
  }

  for (const anchor of originAdjusted(own)) all.set(anchor.name, anchor);

  let countFromAnchors = 0;
  let hasUnderscoreAnchor = false;
  let hasMarkAnchor = false;
  for (const name of all.keys()) {
    hasUnderscoreAnchor ||= name.startsWith("_");
    hasMarkAnchor ||= /^[A-Za-z]/.test(name);

    // Numbered anchors such as top_3 count the components a glyph stands for.
    const split = splitOnce(name);
    if (
      split &&
      !glyph.isLigature &&
      baseGlyphCount === 0 &&
      !name.startsWith("_") &&
      !name.startsWith("entry") &&
      !name.startsWith("exit")
    ) {
      // Carets sit between components, so the last caret is one fewer than the components.
      const addOne = name.startsWith("caret") ? 1 : 0;
      countFromAnchors = Math.max(countFromAnchors, (parseIndex(split[1]) ?? 0) + addOne);
    }
  }
  if (!hasUnderscoreAnchor && baseGlyphCount === 0 && hasMarkAnchor) baseGlyphCount += 1;
  baseGlyphCount = Math.max(baseGlyphCount, countFromAnchors);

  // A mark keeps only the side it does not attach on.
  if (own.some((anchor) => anchor.name === "_bottom")) {
    all.delete("top");
    all.delete("_top");
  }
  if (own.some((anchor) => anchor.name === "_top")) {
    all.delete("bottom");
    all.delete("_bottom");
  }

  return { anchors: [...all.values()], baseGlyphCount };
}

/** Drops an `*origin` anchor and shifts the others by its position. */
function originAdjusted(anchors: readonly PropagationAnchor[]): PropagationAnchor[] {
  const origin = anchors.find((anchor) => anchor.name === "*origin");
  return anchors
    .filter((anchor) => anchor.name !== "*origin")
    .map((anchor) =>
      origin ? { name: anchor.name, x: anchor.x - origin.x, y: anchor.y - origin.y } : anchor,
    );
}

/** Each axis's scale with the rotation removed; negative where the component is flipped. */
function xyScale(matrix: MatModel): { x: number; y: number } {
  const angle = Math.atan2(matrix.b, matrix.a);
  // matrix * rotate(-angle), kurbo's `pre_rotate`.
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  let x = matrix.a * cos + matrix.c * sin;
  let y = matrix.b * -sin + matrix.d * cos;
  if (Math.abs((angle * 180) / Math.PI - 180) < 0.001) {
    x = -x;
    y = -y;
  }
  return { x, y };
}

/** Applies the component's transform, rounded to 1e-6 to absorb floating-point error. */
function transformed(anchor: PropagationAnchor, matrix: MatModel): { x: number; y: number } {
  const x = matrix.a * anchor.x + matrix.c * anchor.y + matrix.e;
  const y = matrix.b * anchor.x + matrix.d * anchor.y + matrix.f;
  return { x: roundMicro(x), y: roundMicro(y) };
}

/** Rounds to six decimal places, halves away from zero as Rust's `f64::round` does. */
function roundMicro(value: number): number {
  const scaled = value * 1e6;
  return (Math.sign(scaled) * Math.round(Math.abs(scaled))) / 1e6;
}

/** `top` becomes `top_N+1` and `top_2` becomes `top_N+2` after `N` earlier base glyphs. */
function ligatureAnchorName(name: string, baseNumber: number): string {
  const split = splitOnce(name);
  if (!split) return `${name}_${baseNumber + 1}`;
  return `${split[0]}_${baseNumber + (parseIndex(split[1]) ?? 1)}`;
}

/** Swaps `top`/`bottom` on a vertically flipped component, and `left`/`right` and `entry`/`exit` on a horizontally flipped one. */
function renameForScale(name: string, scale: { x: number; y: number }): string {
  if (scale.x >= 0 && scale.y >= 0) return name;
  let renamed = name;
  if (scale.y < 0) renamed = swapPair(renamed, "bottom", "top");
  if (scale.x < 0) {
    renamed = swapPair(renamed, "left", "right");
    renamed = swapPair(renamed, "exit", "entry");
  }
  return renamed;
}

/** Replaces the first `one` with `two`, or else the first `two` with `one`. */
function swapPair(name: string, one: string, two: string): string {
  const at = name.indexOf(one);
  if (at >= 0) return name.slice(0, at) + two + name.slice(at + one.length);
  const back = name.indexOf(two);
  if (back >= 0) return name.slice(0, back) + one + name.slice(back + two.length);
  return name;
}

/** Splits at the first underscore, as Rust's `split_once('_')`. */
function splitOnce(name: string): [string, string] | null {
  const at = name.indexOf("_");
  return at < 0 ? null : [name.slice(0, at), name.slice(at + 1)];
}

/** Parses an unsigned index the way Rust's `usize::from_str` does; null when it is not one. */
function parseIndex(text: string): number | null {
  return /^\+?\d+$/.test(text) ? Number(text) : null;
}
