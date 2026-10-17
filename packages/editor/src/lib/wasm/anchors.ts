import { Mat, type DecomposedTransform, type MatModel } from "@shift/geo";
import {
  anchorKind as wasmAnchorKind,
  followAnchors,
  propagateAnchors as wasmPropagate,
} from "@shift/wasm";
import { inputView, nameFor, nameId, outputView } from "./buffers";

/** An anchor's role in mark positioning, read from its name. */
export type AnchorKind =
  /** `top`: marks attach here. */
  | { readonly kind: "base"; readonly group: string }
  /** `_top`: attaches the mark to a base's `top`. */
  | { readonly kind: "mark"; readonly group: string }
  /** `top_2`: marks attach to the second component of a ligature. */
  | { readonly kind: "ligature"; readonly group: string; readonly index: number }
  /** `_3`: a ligature component with no anchors of its own. */
  | { readonly kind: "componentMarker"; readonly index: number }
  /** `caret_1`: a caret position inside a ligature. */
  | { readonly kind: "caret"; readonly index: number }
  /** `vcaret_1`: a vertical caret position inside a ligature. */
  | { readonly kind: "vcaret"; readonly index: number }
  /** `entry` and `exit`: where neighbouring glyphs join in cursive attachment. */
  | { readonly kind: "entry" }
  | { readonly kind: "exit" }
  /** A name export rejects, such as `_`, `top_0`, or `_top_1`. */
  | { readonly kind: "invalid" };

/** Returns the kind fontc reads from an anchor name. */
export function anchorKind(name: string): AnchorKind {
  const result = wasmAnchorKind(name);
  try {
    const group = result.group;
    const index = result.index;
    return {
      kind: result.kind,
      ...(group === undefined ? {} : { group }),
      ...(index === undefined ? {} : { index }),
    } as AnchorKind;
  } finally {
    result.free();
  }
}

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
 * Returns a glyph's anchors as export compiles them, its components' copied in.
 *
 * @remarks
 * Runs shift-font's `anchor_propagation`, the port of fontc's propagation that
 * Rust tests against fontc. A glyph without components keeps its own anchors
 * as authored. Components must already be propagated: callers recurse into
 * component glyphs first.
 */
export function propagateAnchors(glyph: PropagationGlyph): PropagatedAnchors {
  let length = 4 + glyph.anchors.length * 3;
  for (const component of glyph.components) length += 9 + (component.anchors?.length ?? 0) * 3;
  // Interned before taking the view: a new name can grow module memory.
  const ids = new Map<string, number>();
  for (const anchors of [glyph.anchors, ...glyph.components.map((c) => c.anchors ?? [])]) {
    for (const anchor of anchors) ids.set(anchor.name, nameId(anchor.name));
  }
  const input = inputView(length);
  let at = 0;
  const write = (value: number) => {
    input[at++] = value;
  };
  const writeAnchors = (anchors: readonly PropagationAnchor[]) => {
    write(anchors.length);
    for (const anchor of anchors) {
      write(ids.get(anchor.name)!);
      write(anchor.x);
      write(anchor.y);
    }
  };
  write(glyph.isMark ? 1 : 0);
  write(glyph.isLigature ? 1 : 0);
  writeAnchors(glyph.anchors);
  write(glyph.components.length);
  for (const { anchors, baseGlyphCount, matrix } of glyph.components) {
    write(anchors ? 1 : 0);
    write(baseGlyphCount);
    for (const value of [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]) write(value);
    writeAnchors(anchors ?? []);
  }

  wasmPropagate();
  // Copied first: looking up a new name can grow module memory and stale the view.
  const output = outputView().slice();
  const anchors: PropagationAnchor[] = [];
  for (let index = 0; index < (output[1] ?? 0); index++) {
    const at = 2 + index * 3;
    anchors.push({ name: nameFor(output[at]!), x: output[at + 1]!, y: output[at + 2]! });
  }
  return { anchors, baseGlyphCount: output[0] ?? 0 };
}

/** An anchor as alignment reads it. */
export interface AlignmentAnchor {
  readonly name?: string;
  readonly x: number;
  readonly y: number;
}

/** One component of a composite, as it is now and as the workspace last accepted it. */
export interface FollowingComponent {
  /** As the workspace last accepted it. */
  readonly alignment: "anchored" | "free" | "unset";
  readonly transform: DecomposedTransform;
  readonly acceptedTransform: DecomposedTransform;
  /** The component glyph's own anchors now, and as last accepted. */
  readonly anchors: readonly AlignmentAnchor[];
  readonly acceptedAnchors: readonly AlignmentAnchor[];
}

const ALIGNMENT_CODES = { unset: 0, anchored: 1, free: 2 } as const;

/**
 * Returns where each component shows while an edit is in progress.
 *
 * @remarks
 * Runs shift-font's `follow_anchors`, the rule the workspace applies when the
 * edit lands, so a drag shows what the commit will do: anchored components,
 * and unset ones last accepted on their anchors, sit on the current anchors.
 */
export function followingPlacements(components: readonly FollowingComponent[]): MatModel[] {
  let length = 1;
  for (const component of components) {
    length += 22 + (component.anchors.length + component.acceptedAnchors.length) * 3;
  }
  // Interned before taking the view: a new name can grow module memory.
  const ids = new Map<string, number>();
  for (const component of components) {
    for (const anchor of [...component.anchors, ...component.acceptedAnchors]) {
      if (anchor.name !== undefined) ids.set(anchor.name, nameId(anchor.name));
    }
  }
  const input = inputView(length);
  let at = 0;
  const write = (value: number) => {
    input[at++] = value;
  };
  const writeTransform = (transform: DecomposedTransform) => {
    write(transform.translateX);
    write(transform.translateY);
    write(transform.rotation);
    write(transform.scaleX);
    write(transform.scaleY);
    write(transform.skewX);
    write(transform.skewY);
    write(transform.tCenterX);
    write(transform.tCenterY);
  };
  const writeAnchors = (anchors: readonly AlignmentAnchor[]) => {
    write(anchors.length);
    for (const anchor of anchors) {
      write(anchor.name === undefined ? -1 : ids.get(anchor.name)!);
      write(anchor.x);
      write(anchor.y);
    }
  };
  write(components.length);
  for (const component of components) {
    write(ALIGNMENT_CODES[component.alignment]);
    write(1);
    writeTransform(component.transform);
    writeTransform(component.acceptedTransform);
    writeAnchors(component.anchors);
    writeAnchors(component.acceptedAnchors);
  }

  followAnchors();
  const output = outputView();
  const placements: MatModel[] = [];
  for (let index = 0; index < components.length; index++) {
    // Per component: alignment, then the decomposed transform.
    const at = index * 10 + 1;
    placements.push(
      Mat.fromDecomposed({
        translateX: output[at]!,
        translateY: output[at + 1]!,
        rotation: output[at + 2]!,
        scaleX: output[at + 3]!,
        scaleY: output[at + 4]!,
        skewX: output[at + 5]!,
        skewY: output[at + 6]!,
        tCenterX: output[at + 7]!,
        tCenterY: output[at + 8]!,
      }),
    );
  }
  return placements;
}
