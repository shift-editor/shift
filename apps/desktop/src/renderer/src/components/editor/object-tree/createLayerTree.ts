import type { Editor } from "@shift/editor";
import type { NodeId } from "@shift/types";
import type { ObjectTreeItem, ObjectTreeSection } from "@/types/objectTree";

/** The longest text a text box's row shows before trimming it. */
const LABEL_LENGTH = 40;

/**
 * Builds the Layers section: the boxes on the active page, frames with their
 * children nested, in drawing order.
 *
 * @remarks
 * Call it inside a computed that reads the active page and the scene's
 * structure: it reads each box's record, so a row follows its box's text and
 * name, and the caller follows boxes being added, removed, or reordered.
 *
 * @param structure - the scene's structure, as the caller read it.
 */
export function createLayerTree(
  editor: Editor,
  pageId: NodeId | null,
  structure: LayerStructure,
): ObjectTreeSection {
  const items = pageId ? layerItems(editor, structure, structure.children(pageId)) : [];
  return { id: "layers", label: "Layers", items };
}

/** The part of the scene's structure the Layers section walks. */
interface LayerStructure {
  children(id: NodeId): readonly NodeId[];
}

function layerItems(
  editor: Editor,
  structure: LayerStructure,
  ids: readonly NodeId[],
): ObjectTreeItem[] {
  const items: ObjectTreeItem[] = [];
  for (const id of ids) {
    const node = editor.scene.record(id);
    switch (node?.kind) {
      case "textRun":
        items.push({
          id,
          kind: "node",
          icon: "text",
          label: textLabel(editor, node),
          children: [],
        });
        break;
      case "frame":
        items.push({
          id,
          kind: "node",
          icon: "frame",
          label: node.name,
          children: layerItems(editor, structure, structure.children(id)),
        });
        break;
      default:
        break;
    }
  }
  return items;
}

/** A text box's row label: its text on one line, trimmed; "Text" while empty. */
function textLabel(editor: Editor, node: Parameters<Editor["text"]["items"]>[0]): string {
  let text = "";
  for (const item of editor.text.items(node)) {
    if (text.length >= LABEL_LENGTH) break;
    switch (item.kind) {
      case "character":
        text += String.fromCodePoint(item.codepoint);
        break;
      case "glyph":
        text += `/${editor.font.entryForId(item.glyphId)?.name ?? "?"}`;
        break;
      case "linebreak":
        text += " ";
        break;
    }
  }
  const label = text.replace(/\s+/g, " ").trim();
  if (!label) return "Text";
  return label.length > LABEL_LENGTH ? `${label.slice(0, LABEL_LENGTH)}…` : label;
}
