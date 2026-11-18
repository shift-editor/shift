import type { Editor } from "@shift/editor";
import type { Axis } from "@shift/editor/model";
import { computed, type Signal } from "@shift/editor/signals";
import { axisValue, withExternalAxisValue } from "@shift/editor/variation";
import { isComponentId, type AxisId, type ComponentInheritance } from "@shift/types";
import type { Component } from "@shift/glyph-state";
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
 * Font axis values are in user units, as Font axes shows them. When the
 * components share a base glyph with axes of its own, those follow the font's
 * axes, in the axis's own units; one they don't set is at its default, since
 * glyph axes are never inherited.
 *
 * @returns null unless the selection is only components on the drawing being
 * edited (a source's, or one located off them), with an axis to set:
 * between drawings there is nothing to edit.
 */
export function selectedComponentLocationCell(
  editor: Editor,
): Signal<SelectedComponentLocation | null> {
  return computed(() => {
    const parent = editor.externalLocationCell.value;
    const editing =
      editor.activeSourceIdCell.value !== null || editor.activeDrawingCell.value !== null;
    const axes = editor.font.externalAxesCell.value.filter(
      (axis) => !axis.isDiscrete && axis.varies,
    );
    const ids = editor.selection.stateCell.value.ids;
    if (!editing || ids.length === 0 || !ids.every(isComponentId)) return null;

    // Mapped to the edited drawing's own components, which store its location.
    const components = editor.selectedComponentsAtActiveSource();
    if (!components) return null;

    const glyphAxes = sharedBaseGlyphAxes(editor, components);
    if (axes.length === 0 && glyphAxes.length === 0) return null;

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
        followed.push({
          axis,
          kind: "font",
          follows: round(drawnAt(axis, first.location, first.inheritance)),
        });
        continue;
      }

      const first = values[0];
      const same = first !== null && values.every((value) => value === first);
      set.push({ axis, kind: "font", value: same ? round(first) : null });
    }

    for (const axis of glyphAxes) {
      const values = components.map((component) => component.location.get(axis.id) ?? null);
      if (values.every((value) => value === null)) {
        followed.push({ axis, kind: "glyph", follows: axis.kind.default });
        continue;
      }

      // Unset is the default: glyph axes are never inherited.
      const drawn = values.map((value) => value ?? axis.kind.default);
      const first = drawn[0]!;
      const same = drawn.every((value) => value === first);
      set.push({ axis, kind: "glyph", value: same ? round(first) : null });
    }

    const bases = new Set(components.map((component) => component.baseGlyphName));
    const title =
      bases.size === 1 ? components[0]!.baseGlyphName : `${components.length} components`;

    return { title, set, followed };
  });
}

/**
 * Sets the axis `axisId` on the selected components to `value` at the
 * drawing being edited: in user units for a font axis, in its own units for
 * one of their base glyph's axes.
 *
 * @returns `false` when the axis is not in the font or the selection is not
 * entirely components on the active source.
 */
export function setSelectedComponentAxis(
  editor: Editor,
  axisId: AxisId,
  value: number,
): Promise<boolean> {
  const components = editor.selectedComponentsAtActiveSource() ?? [];
  const glyphAxis = sharedBaseGlyphAxes(editor, components).find(({ id }) => id === axisId);
  // A base glyph's own axis has no mapping: the value is stored as given.
  if (glyphAxis) return editor.setSelectedComponentsAxis(axisId, value);

  const axis = editor.font.externalAxesCell.peek().find((candidate) => candidate.id === axisId);
  if (!axis) return Promise.resolve(false);

  const parent = editor.externalLocationCell.peek();
  const design = editor.font.designspace.toDesign(withExternalAxisValue(parent, axis, value));
  return editor.setSelectedComponentsAxis(axis.id, design.get(axis.id) ?? value);
}

/** The own axes of the glyph every one of `components` draws; none when their bases differ. */
function sharedBaseGlyphAxes(editor: Editor, components: readonly Component[]): readonly Axis[] {
  const bases = new Set(components.map((component) => component.baseGlyphId));
  const [base] = bases;
  if (bases.size !== 1 || !base) return [];

  return editor.glyphForId(base)?.axes ?? [];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
