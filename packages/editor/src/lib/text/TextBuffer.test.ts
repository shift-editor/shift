import { describe, expect, it } from "vitest";
import { characterTextItem as char, lineBreakTextItem } from "./layout/types";
import { TextBuffer } from "./TextBuffer";

/** Returns what an edit leaves: the items, and the carets as the items they follow. */
function contents(buffer: TextBuffer | null) {
  return buffer && { items: buffer.items, anchor: buffer.anchor, focus: buffer.focus };
}

describe("text item edits preserve caret identity", () => {
  it("starts with an empty selection at the run start", () => {
    const buffer = new TextBuffer([]);
    expect(buffer.selection).toEqual({ start: 0, end: 0 });
    expect(buffer.focusCluster).toBe(0);
  });

  it("insertion advances both carets after the new item", () => {
    const a = char(65);
    expect(contents(new TextBuffer([]).splice([a]))).toEqual({
      items: [a],
      anchor: a.id,
      focus: a.id,
    });
  });

  it("replaces a forward or backward selection and collapses to its end", () => {
    const [a, b, c, x] = [char(65), char(66), char(67), char(88)];
    expect(contents(new TextBuffer([a, b, c], a.id, c.id).splice([x]))).toEqual({
      items: [a, x],
      anchor: x.id,
      focus: x.id,
    });
  });

  it("backspace removes the preceding item and keeps the preceding caret", () => {
    const a = char(65);
    const b = char(66);
    expect(contents(new TextBuffer([a, b], b.id).delete(-1))).toEqual({
      items: [a],
      anchor: a.id,
      focus: a.id,
    });
  });

  it("backspace at the beginning is a no-op", () => {
    expect(new TextBuffer([]).delete(-1)).toBeNull();
  });

  it("deletion of selected items collapses at selection start", () => {
    const [a, b, c] = [char(65), char(66), char(67)];
    expect(contents(new TextBuffer([a, b, c], c.id, a.id).delete(-1))).toEqual({
      items: [a],
      anchor: a.id,
      focus: a.id,
    });
  });

  it("select-all spans the item buffer, including linebreaks", () => {
    const items = [char(65), lineBreakTextItem(), char(66)];
    expect(new TextBuffer(items, items[2].id, null).selection).toEqual({ start: 0, end: 3 });
  });

  it("caret placement clamps to the current item count", () => {
    const buffer = new TextBuffer([char(65), char(66)]);
    expect(buffer.caretAt(99)).toBe(buffer.items[1].id);
    expect(buffer.caretAt(-1)).toBeNull();
  });

  it("an item identity follows insertions and deletions before it", () => {
    const [a, b, x] = [char(65), char(66), char(88)];
    const inserted = new TextBuffer([a, b]).splice([x]);
    expect(inserted.clusterOf(b.id)).toBe(3);
    const removed = new TextBuffer(inserted.items, a.id, null).delete(-1)!;
    expect(removed.clusterOf(b.id)).toBe(1);
    expect(removed.clusterOf(a.id)).toBe(0);
  });

  it("word navigation stops at whitespace and punctuation", () => {
    const buffer = new TextBuffer([char(65), char(32), char(66)]);
    expect(buffer.wordStep(3, -1)).toBe(2);
    expect(buffer.wordStep(0, 1)).toBe(1);
  });
});
