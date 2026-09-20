import type { Editor } from "@/lib/editor/Editor";
import { objectIsKindOf, type ShiftObjectOf } from "@/types";

/** Resolves an all-component selection owned by one editable glyph layer. */
export function selectedComponentObjects(editor: Editor): readonly ShiftObjectOf<"component">[] {
  const ids = editor.selection.ids;
  const objects = editor.objects(ids);
  if (objects.length !== ids.length) return [];

  const components: ShiftObjectOf<"component">[] = [];
  for (const object of objects) {
    if (!objectIsKindOf(object, "component")) return [];

    components.push(object);
  }

  const firstLayer = components[0]?.layer;
  if (!firstLayer || components.some((component) => component.layer !== firstLayer)) return [];

  return components;
}
