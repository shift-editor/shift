import type { Editor } from "@shift/editor";
import type { Axis } from "@shift/editor/model";
import { computed, type Signal } from "@shift/editor/signals";
import { axisValue, withExternalAxisValue } from "@shift/editor/variation";
import { isComponentId, type AxisId, type ComponentInheritance } from "@shift/types";
import type {
  FollowedComponentAxis,
  SelectedComponentLocation,
  SetComponentAxis,
} from "@/types/componentLocation";

/**
 * The selected components' location at the active source, as the
 * Designspace tab shows it: each axis they set, with its value (null when
 * they differ), and each axis they don't, with where they follow it to.
 *
 * @remarks
 * Recomputes as the selection, source, location or the components change.
 * Values are in user units, as Font axes shows them.
 *
 * @returns null unless the selection is only components on the source being
 * edited, in a font with varying axes: off a source there is nothing to edit.
 */
export function selectedComponentLocationCell(
  editor: Editor,
): Signal<SelectedComponentLocation | null> {
  return computed(() => {
    const parent = editor.externalLocationCell.value;
    const sourceId = editor.activeSourceIdCell.value;
    const axes = editor.font.externalAxesCell.value.filter(
      (axis) => !axis.isDiscrete && axis.varies,
    );
    const ids = editor.selection.stateCell.value.ids;
    if (sourceId === null || axes.length === 0 || ids.length === 0 || !ids.every(isComponentId)) {
      return null;
    }

    // Mapped to the active source's own components, which store its location.
    const components = editor.selectedComponentsAtActiveSource();
    if (!components) return null;

    const designspace = editor.font.designspace;
    const drawnAt = (
      axis: Axis,
      location: ReadonlyMap<AxisId, number>,
      inheritance: ComponentInheritance,
    ) => axisValue(designspace.componentBaseLocation(parent, location, inheritance), axis);

    const set: SetComponentAxis[] = [];
    const followed: FollowedComponentAxis[] = [];
    for (const axis of axes) {
      const values = components.map((component) => {
        const design = component.location.get(axis.id);
        if (design === undefined) return null;

        return drawnAt(axis, new Map([[axis.id, design]]), component.inheritance);
      });
      if (values.every((value) => value === null)) {
        const first = components[0]!;
        followed.push({ axis, follows: round(drawnAt(axis, first.location, first.inheritance)) });
        continue;
      }

      const first = values[0];
      const same = first !== null && values.every((value) => value === first);
      set.push({ axis, value: same ? round(first) : null });
    }

    const bases = new Set(components.map((component) => component.baseGlyphName));
    const title =
      bases.size === 1 ? components[0]!.baseGlyphName : `${components.length} components`;

    return { title, set, followed };
  });
}

/**
 * Sets the axis `axisId` on the selected components to `value`, in user
 * units, at the active source.
 *
 * @returns `false` when the axis is not in the font or the selection is not
 * entirely components on the active source.
 */
export function setSelectedComponentAxis(
  editor: Editor,
  axisId: AxisId,
  value: number,
): Promise<boolean> {
  const axis = editor.font.externalAxesCell.peek().find((candidate) => candidate.id === axisId);
  if (!axis) return Promise.resolve(false);

  const parent = editor.externalLocationCell.peek();
  const design = editor.font.designspace.toDesign(withExternalAxisValue(parent, axis, value));
  return editor.setSelectedComponentsAxis(axis.id, design.get(axis.id) ?? value);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
