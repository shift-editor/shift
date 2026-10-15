import { useEffect, useState } from "react";
import type { FontFeature } from "@shift/types";
import { useSignalState } from "@shift/editor/signals";
import type { Editor } from "@shift/editor";
import { useEditor } from "@/workspace/WorkspaceContext";

/** Features a script's shaping needs or export generates; they stay out of the list. */
const REQUIRED_FEATURES = new Set([
  "aalt",
  "abvf",
  "abvm",
  "abvs",
  "akhn",
  "blwf",
  "blwm",
  "blws",
  "ccmp",
  "cfar",
  "cjct",
  "curs",
  "dist",
  "fin2",
  "fin3",
  "fina",
  "half",
  "haln",
  "init",
  "isol",
  "kern",
  "ljmo",
  "locl",
  "mark",
  "med2",
  "medi",
  "mkmk",
  "nukt",
  "pref",
  "pres",
  "pstf",
  "psts",
  "rclt",
  "rkrf",
  "rlig",
  "rphf",
  "rvrn",
  "stch",
  "tjmo",
  "vjmo",
  "vatu",
]);

/** Features a shaper applies unless told otherwise; every other listed feature starts off. */
const ON_BY_DEFAULT = new Set(["calt", "clig", "liga"]);

/** Whether a feature is on for text that leaves it at the font's default. */
export function onByDefault(tag: string): boolean {
  return ON_BY_DEFAULT.has(tag);
}

/** The groups the features panel lists features under, in the order it lists them. */
const GROUPS: readonly { readonly title: string; readonly matches: (tag: string) => boolean }[] = [
  { title: "Ligatures", matches: (tag) => ["liga", "dlig", "hlig", "clig"].includes(tag) },
  {
    title: "Letter case",
    matches: (tag) =>
      ["smcp", "c2sc", "pcap", "c2pc", "unic", "titl", "case", "cpsp"].includes(tag),
  },
  { title: "Figures", matches: (tag) => ["onum", "lnum", "tnum", "pnum", "zero"].includes(tag) },
  {
    title: "Fractions and positions",
    matches: (tag) =>
      ["frac", "afrc", "numr", "dnom", "sups", "subs", "sinf", "ordn"].includes(tag),
  },
  { title: "Stylistic sets", matches: (tag) => /^ss\d\d$/.test(tag) },
  { title: "Character variants", matches: (tag) => /^cv\d\d$/.test(tag) },
  {
    title: "Alternates",
    matches: (tag) => ["calt", "salt", "swsh", "cswh", "hist", "nalt", "ornm"].includes(tag),
  },
];

/** One heading of the features panel and the features under it. */
export interface FeatureGroup {
  readonly title: string;
  readonly features: readonly FontFeature[];
}

/** Sorts features under the panel's headings; a feature no heading claims goes under "Other". */
export function groupFeatures(features: readonly FontFeature[]): FeatureGroup[] {
  const groups = GROUPS.map((group) => ({
    title: group.title,
    features: features.filter((feature) => group.matches(feature.tag)),
  }));
  const claimed = new Set(groups.flatMap((group) => group.features));
  groups.push({ title: "Other", features: features.filter((feature) => !claimed.has(feature)) });
  return groups.filter((group) => group.features.length > 0);
}

/** The last features listed for each editor, and the font state they were read at. */
const listed = new WeakMap<
  Editor,
  { readonly revision: number; readonly glyphs: unknown; readonly features: readonly FontFeature[] }
>();

/**
 * Lists the font's user-facing features; empty in a preview, which has no
 * shaping. Starts from the last list read at the same font state, so a panel
 * opened again shows its features at once instead of filling in.
 */
export function useFontFeatures(): readonly FontFeature[] {
  const editor = useEditor();
  const featureRevision = useSignalState(editor.font.featureRevisionCell);
  // Glyph names generate features too: a new `a.ss04` adds ss04.
  const glyphs = useSignalState(editor.font.glyphEntriesCell);
  const cached = listed.get(editor);
  const fresh = cached?.revision === featureRevision && cached.glyphs === glyphs;
  const [features, setFeatures] = useState<readonly FontFeature[]>(fresh ? cached.features : []);
  useEffect(() => {
    if (editor.sessionMode !== "workspace") return;
    let current = true;
    editor.font
      .features()
      .then((all) => {
        const shown = all.filter((feature) => !REQUIRED_FEATURES.has(feature.tag));
        listed.set(editor, { revision: featureRevision, glyphs, features: shown });
        if (current) setFeatures(shown);
      })
      .catch((error: unknown) => console.error("failed to list font features", error));
    return () => {
      current = false;
    };
  }, [editor, featureRevision, glyphs]);
  return features;
}
