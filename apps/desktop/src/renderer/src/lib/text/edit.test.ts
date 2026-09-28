import { describe, expect, it } from "vitest";
import { glyphTextItem as glyph, lineBreakTextItem } from "@shift/editor/text";
import {
  caretForCluster,
  clusterForCaret,
  deleteText,
  selectionRange,
  spliceText,
  wordCluster,
} from "@shift/editor/text";

describe("text item edits preserve caret identity", () => {
  it("starts with an empty selection at the run start", () => {
    expect(selectionRange([], null, null)).toEqual({ start: 0, end: 0 });
    expect(clusterForCaret([], null)).toBe(0);
  });

  it("insertion advances both carets after the new item", () => {
    const a = glyph("A");
    expect(spliceText([], null, null, [a])).toEqual({ items: [a], anchor: a.id, focus: a.id });
  });

  it("replaces a forward or backward selection and collapses to its end", () => {
    const [a, b, c, x] = [glyph("A"), glyph("B"), glyph("C"), glyph("X")];
    expect(spliceText([a, b, c], c.id, a.id, [x])).toEqual({
      items: [a, x],
      anchor: x.id,
      focus: x.id,
    });
  });

  it("backspace removes the preceding item and keeps the preceding caret", () => {
    const a = glyph("A");
    const b = glyph("B");
    expect(deleteText([a, b], b.id, b.id, -1)).toEqual({ items: [a], anchor: a.id, focus: a.id });
  });

  it("backspace at the beginning is a no-op", () => {
    expect(deleteText([], null, null, -1)).toBeNull();
  });

  it("deletion of selected items collapses at selection start", () => {
    const [a, b, c] = [glyph("A"), glyph("B"), glyph("C")];
    expect(deleteText([a, b, c], a.id, c.id, -1)).toEqual({
      items: [a],
      anchor: a.id,
      focus: a.id,
    });
  });

  it("select-all spans the item buffer, including linebreaks", () => {
    const items = [glyph("A"), lineBreakTextItem(), glyph("B")];
    expect(selectionRange(items, null, items[2].id)).toEqual({ start: 0, end: 3 });
  });

  it("caret placement clamps to the current item count", () => {
    const items = [glyph("A"), glyph("B")];
    expect(caretForCluster(items, 99)).toBe(items[1].id);
    expect(caretForCluster(items, -1)).toBeNull();
  });

  it("an item identity follows insertions and deletions before it", () => {
    const [a, b, x] = [glyph("A"), glyph("B"), glyph("X")];
    const inserted = spliceText([a, b], null, null, [x]);
    expect(clusterForCaret(inserted.items, b.id)).toBe(3);
    const removed = deleteText(inserted.items, null, a.id, -1)!;
    expect(clusterForCaret(removed.items, b.id)).toBe(1);
    expect(clusterForCaret(removed.items, a.id)).toBe(0);
  });

  it("word navigation stops at whitespace and punctuation", () => {
    const items = [glyph("A", 65), glyph(" ", 32), glyph("B", 66)];
    expect(wordCluster(items, 3, -1)).toBe(2);
    expect(wordCluster(items, 0, 1)).toBe(1);
  });
});
