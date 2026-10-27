/**
 * Checks an edit the way a user relies on it: it does what it should, undo
 * puts the glyph back, redo puts the edit back, and saving and reopening the
 * document keeps it.
 *
 * @example
 * await expectEdit(editor, (e) => e.dragPoint(b, { x: 36, y: 30 }), {
 *   [a]: { x: 136, y: 130 },
 *   [b]: { x: 186, y: 180 },
 * });
 *
 * @remarks
 * Undo and redo are compared on the whole {@link Outline}, ids included, so an
 * edit that leaves something behind on undo fails even when the expected
 * points look right. ProseMirror's `testTransform` checks steps the same way.
 */
import { expect } from "vitest";
import type { Point2D } from "@shift/geo";
import type { PointId } from "@shift/types";
import type { EditorTestSurface } from "./surface";

/** Where points should end up, or assertions to run on an editor holding the edit. */
export type EditExpectation = Record<PointId, Point2D> | ((editor: EditorTestSurface) => void);

export async function expectEdit(
  editor: EditorTestSurface,
  act: (editor: EditorTestSurface) => unknown,
  expected: EditExpectation,
): Promise<void> {
  await editor.settle();
  const before = editor.outline();

  await act(editor);
  await editor.settle();
  check(editor, expected, "after the edit");
  const after = editor.outline();

  await editor.undo();
  await editor.settle();
  expect(editor.outline(), "undo restores the glyph").toEqual(before);

  await editor.redo();
  await editor.settle();
  expect(editor.outline(), "redo reapplies the edit").toEqual(after);

  const reopened = await editor.reopen();
  try {
    expect(reopened.outline(), "the reopened document keeps the edit").toEqual(after);
    check(reopened, expected, "after reopening");
  } finally {
    await reopened.close();
  }
}

function check(editor: EditorTestSurface, expected: EditExpectation, when: string): void {
  if (typeof expected === "function") {
    expected(editor);
    return;
  }
  const ids = Object.keys(expected) as PointId[];
  expect(editor.pointPositions(ids), `point positions ${when}`).toEqual(expected);
}
