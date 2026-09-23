import type {
  ComponentTransformSelection,
  ComponentTransformSelectionLayer,
} from "@shift/editor/types";
import type { MatModel } from "@shift/geo";

export function commitComponentTransform(
  selection: ComponentTransformSelection,
  label: string,
  deltaForLayer: (layer: ComponentTransformSelectionLayer) => MatModel,
): void {
  const edit = selection.layer.beginComponentTransformEdit(selection);

  try {
    edit.preview(deltaForLayer);
    edit.commit(label);
  } catch (error) {
    edit.discard();
    throw error;
  }
}
