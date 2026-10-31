/**
 * The one builder both test drivers draw a {@link GlyphFixture} with: vitest's
 * `TestEditor.draw` calls it in-process, and Playwright's `EditorDriver.draw`
 * calls it in the app's renderer through the E2E actions hook.
 *
 * @remarks
 * It uses only the editor's public commands, the ones the UI calls: the
 * advance field's `setXAdvance`, paste's `insertContent`, the anchor tool's
 * `addAnchorAt` and the sidebar's `renameAnchor`, Add Component's
 * `addComponent`, and the sidebar's component position fields.
 */
import type { Editor } from "@shift/editor";
import { Mat } from "@shift/geo";
import type { AnchorId, GlyphName, PointId } from "@shift/types";
import {
  contourContent,
  pointNames,
  type ComponentFixture,
  type DrawOptions,
  type GlyphFixture,
  type PointNames,
} from "./fixtures";

/**
 * Draws `fixture` into the open glyph and waits until the workspace has
 * confirmed every edit.
 *
 * @param options - `select` selects every point drawn, in drawing order;
 * otherwise nothing is selected afterwards.
 * @returns the minted point ids, keyed by each point's `name`.
 * @throws {Error} when no single glyph is open, or a component's glyph is missing.
 */
export async function drawFixture<const F extends GlyphFixture>(
  editor: Editor,
  fixture: F,
  options: DrawOptions = {},
): Promise<Record<PointNames<F>, PointId>> {
  const names = {} as Record<PointNames<F>, PointId>;
  if (fixture.advance !== undefined) editor.setXAdvance(fixture.advance);

  const contours = fixture.contours ?? [];
  let drawn: readonly PointId[] = [];
  if (contours.length > 0) {
    const ids = editor.insertContent(contourContent(contours));
    if (!ids) throw new Error("draw needs one open glyph to draw into");
    drawn = ids as readonly PointId[];
    pointNames(contours).forEach((name, index) => {
      if (name !== null) (names as Record<string, PointId>)[name] = drawn[index]!;
    });
  }

  for (const anchor of fixture.anchors ?? []) {
    if (!editor.addAnchorAt({ x: anchor.x, y: anchor.y })) {
      throw new Error(`draw could not add anchor ${anchor.name}`);
    }
    const [anchorId] = editor.selection.ids;
    if (anchorId) editor.renameAnchor(anchorId as AnchorId, anchor.name);
  }

  for (const component of fixture.components ?? []) await drawComponent(editor, component);

  if (options.select) editor.selection.select(drawn);
  else editor.selection.clear();
  await settle(editor);
  return names;
}

/** Adds a component and moves it as the sidebar's position fields do. */
async function drawComponent(editor: Editor, component: ComponentFixture): Promise<void> {
  const base = editor.font.recordForName(component.glyph as GlyphName);
  if (!base) throw new Error(`draw needs a glyph named ${component.glyph}`);

  const id = await editor.addComponent(base.id);
  if (!id) throw new Error(`draw could not add component ${component.glyph}`);

  const { x = 0, y = 0 } = component;
  if (x === 0 && y === 0) return;
  // The component can be selected and moved once the workspace confirms it.
  await settle(editor);
  const selection = editor.componentTransformSelection([id]);
  if (!selection) throw new Error(`draw could not move component ${component.glyph}`);
  selection.layer.transformComponents(selection, "Move components", () => Mat.Translate(x, y));
}

async function settle(editor: Editor): Promise<void> {
  await editor.font.editCoordinator.settled();
  await editor.text.settled();
}
