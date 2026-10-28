import type { GlyphId, SelectableId } from "@shift/types";
import { computed, track, untracked } from "../signals/signal";
import type { Signal } from "../signals/signal";
import type { GlyphNode } from "../../types/node";
import type { Editor } from "./Editor";

/**
 * The glyph nodes the sidebar, metric edits, and single-glyph gestures act on.
 *
 * @remarks
 * Subjects are the glyph nodes the selection belongs to; with nothing of a
 * glyph selected, the glyph nodes being edited; with none edited, every glyph
 * node in the scene. A page holding several glyphs answers "which glyph" here,
 * never by taking the scene's first or only glyph node.
 */
export class GlyphSubjects {
  /** See {@link Editor.subjectGlyphNodesCell}. */
  readonly nodesCell: Signal<readonly GlyphNode[]>;
  /** See {@link Editor.subjectGlyphIdsCell}. */
  readonly glyphIdsCell: Signal<readonly GlyphId[]>;
  /** See {@link Editor.soleSubjectGlyphNodeCell}. */
  readonly soleNodeCell: Signal<GlyphNode | null>;

  constructor(editor: Editor) {
    this.nodesCell = computed(
      () => {
        track(editor.scene.cell);
        const ids = editor.selection.stateCell.value.ids;
        const editedIds = editor.editing.stateCell.value.nodeIds;
        // Resolving a selected id reads its layer's geometry; untracked, so a
        // drag of the selection does not rerun this on every frame. The scene
        // and selection above are what change which nodes own it.
        const owners = untracked(() => selectionOwners(editor, ids));
        if (owners.length > 0) return owners;

        const glyphNodes = editor.scene.nodesOfKind("glyph");
        const edited = new Set(editedIds);
        const editedGlyphs = glyphNodes.filter((node) => edited.has(node.id));
        return editedGlyphs.length > 0 ? editedGlyphs : glyphNodes;
      },
      { name: "editor.subjectGlyphNodes", equals: sameItems },
    );
    this.glyphIdsCell = computed(
      () => this.nodesCell.value.flatMap((node) => editor.glyphIdOf(node) ?? []),
      { name: "editor.subjectGlyphIds", equals: sameItems },
    );
    this.soleNodeCell = computed(
      () => {
        const nodes = this.nodesCell.value;
        return nodes.length === 1 ? nodes[0]! : null;
      },
      { name: "editor.soleSubjectGlyphNode" },
    );
  }
}

/** The glyph nodes the selected ids belong to, in selection order, each once. */
function selectionOwners(editor: Editor, ids: readonly SelectableId[]): readonly GlyphNode[] {
  const owners = new Set<GlyphNode>();
  for (const id of ids) {
    const node = editor.object(id)?.node;
    if (node?.kind === "glyph") owners.add(node);
  }
  return [...owners];
}

/** Whether two lists hold the same items in the same order. */
function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
