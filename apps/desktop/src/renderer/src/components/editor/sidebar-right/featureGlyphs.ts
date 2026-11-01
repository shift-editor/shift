import { useEffect, useMemo } from "react";
import type { Editor } from "@shift/editor";
import { useSignalState } from "@shift/editor/signals";
import {
  characterTextItem,
  type FeatureSubstitution,
  type TextItem,
  type TextRunRecord,
} from "@shift/editor/text";
import type { GlyphId } from "@shift/types";
import type { FeatureGlyph, FeatureGlyphs } from "@/types/features";
import { useEditor } from "@/workspace/WorkspaceContext";

/** How many of a feature's glyphs the preview draws; a large set shows its first ones. */
export const MAX_PREVIEW_GLYPHS = 120;

const SPACE = 0x20;

/**
 * The glyphs a feature brings in, with what each replaces, read from the
 * shaper the editor shapes with, or why they could not be read; loads the
 * ones the preview draws.
 */
export function useFeatureGlyphs(tag: string): FeatureGlyphs {
  const editor = useEditor();
  const listing = useSignalState(editor.text.featureSubstitutionsCell(tag));
  const glyphs = useMemo(
    () => groupByOutput(listing.kind === "listed" ? listing.substitutions : []),
    [listing],
  );

  useEffect(() => {
    const shown = glyphs.slice(0, MAX_PREVIEW_GLYPHS).map(({ glyph }) => glyph);
    const load = async () => {
      try {
        await editor.font.loadGlyphs(shown);
      } catch (error) {
        console.error("failed to load a feature's glyphs", error);
      }
    };
    void load();
  }, [editor, glyphs]);

  return { glyphs, error: listing.kind === "failed" ? listing.error : null };
}

/** One entry per output glyph, in the substitutions' order. */
function groupByOutput(substitutions: readonly FeatureSubstitution[]): FeatureGlyph[] {
  const replaced = new Map<GlyphId, (readonly GlyphId[])[]>();
  for (const { input, output } of substitutions) {
    const inputs = replaced.get(output);
    if (inputs) inputs.push(input);
    else replaced.set(output, [input]);
  }
  return replaced.entries().map(toFeatureGlyph).toArray();
}

function toFeatureGlyph([glyph, replaces]: [GlyphId, (readonly GlyphId[])[]]): FeatureGlyph {
  return { glyph, replaces };
}

/**
 * The items for glyph sequences, a space apart so one sequence's rules do
 * not reach into the next; a glyph the font maps a character to becomes
 * that character, so it shapes like typed text.
 */
export function inputItems(editor: Editor, sequences: readonly (readonly GlyphId[])[]): TextItem[] {
  return sequences
    .filter((sequence) => sequence.length > 0)
    .flatMap((sequence, index) => {
      const glyphs = sequence.flatMap((id) => editor.text.glyphItem(id) ?? []);
      return index === 0 ? glyphs : [characterTextItem(SPACE), ...glyphs];
    });
}

/** Inserts items at the caret while typing in the run, otherwise at its end. */
export function insertIntoRun(
  editor: Editor,
  run: TextRunRecord,
  items: readonly TextItem[],
): void {
  if (items.length === 0) return;

  if (editor.textEditing.state) {
    editor.textEditing.insert(items);
    return;
  }
  editor.history.capture("Insert glyphs", () =>
    editor.text.setItems(run.id, [...run.items, ...items]),
  );
}
