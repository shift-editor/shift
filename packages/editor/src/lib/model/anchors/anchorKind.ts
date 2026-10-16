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

/**
 * Returns the kind export reads from an anchor name.
 *
 * @remarks
 * A port of fontir's `AnchorKind::new` (after ufo2ft's mark feature writer),
 * kept line for line; tests compare it with fontir through the bridge.
 */
export function anchorKind(name: string): AnchorKind {
  if (name === "entry") return { kind: "entry" };
  if (name === "exit") return { kind: "exit" };

  const caretPrefix = ["caret_", "vcaret_"].find((prefix) => name.startsWith(prefix));
  if (caretPrefix) {
    const kind = caretPrefix === "vcaret_" ? "vcaret" : "caret";
    const index = parseIndex(name.slice(caretPrefix.length));
    if (index === 0) return { kind: "invalid" };
    // A caret with no number, or a malformed one, is the first.
    return { kind, index: index ?? 1 };
  }

  // `_` prefixes marks and also spaces ligature names (`top_1`); `_4` alone
  // marks a ligature component with no anchors.
  if (name.startsWith("_")) {
    const suffix = name.slice(1);
    const index = parseIndex(suffix);
    if (index !== null)
      return index === 0 ? { kind: "invalid" } : { kind: "componentMarker", index };
    if (suffix === "") return { kind: "invalid" };
    const numbered = rsplitOnce(suffix);
    if (numbered && parseIndex(numbered[1]) !== null) return { kind: "invalid" };
    return { kind: "mark", group: suffix };
  }

  const ligature = rsplitOnce(name);
  if (ligature) {
    const index = parseIndex(ligature[1]);
    if (index !== null) {
      return index === 0 ? { kind: "invalid" } : { kind: "ligature", group: ligature[0], index };
    }
  }
  return { kind: "base", group: name };
}

/** Splits at the last underscore, as Rust's `rsplit_once('_')`. */
function rsplitOnce(name: string): [string, string] | null {
  const at = name.lastIndexOf("_");
  return at < 0 ? null : [name.slice(0, at), name.slice(at + 1)];
}

/** Parses an unsigned index the way Rust's `usize::from_str` does; null when it is not one. */
export function parseIndex(text: string): number | null {
  return /^\+?\d+$/.test(text) ? Number(text) : null;
}
