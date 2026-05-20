import { describe, it, expect, beforeEach } from "vitest";
import { TextBuffer } from "./TextBuffer";
import { glyphTextItem as glyph } from "./layout";

describe("TextBuffer", () => {
  let buffer: TextBuffer;

  beforeEach(() => {
    buffer = new TextBuffer();
  });

  // SEED — fresh buffer is empty with cursor at 0.
  it("starts empty", () => {
    expect(buffer.items).toEqual([]);
    expect(buffer.length).toBe(0);
    expect(buffer.cursor).toBe(0);
    expect(buffer.anchor).toBe(0);
    expect(buffer.hasSelection).toBe(false);
  });

  // SEED — insert appends and advances cursor + anchor.
  it("insert places item at cursor and advances both cursor and anchor", () => {
    const a = glyph("A");
    buffer.insert(a);

    expect(buffer.items).toEqual([a]);
    expect(buffer.cursor).toBe(1);
    expect(buffer.anchor).toBe(1);
    expect(buffer.hasSelection).toBe(false);
  });

  // before:  [A, B, C]    anchor=1, cursor=3   selection = [1, 3) → B, C
  // insert(X)
  // after:   [A, X]       cursor = anchor = 2  (X collapses BC + caret advances)
  it("insert replaces an active selection", () => {
    const a = glyph("A");
    const b = glyph("B");
    const c = glyph("C");
    const x = glyph("X");
    buffer.insertMany([a, b, c]);
    buffer.selectRange(1, 3);

    buffer.insert(x);

    expect(buffer.items).toEqual([a, x]);
    expect(buffer.cursor).toBe(2);
    expect(buffer.anchor).toBe(2);
  });

  // SEED — backspace with no selection removes one item before cursor.
  it("delete removes item before cursor when there is no selection", () => {
    const a = glyph("A");
    buffer.insertMany([a, glyph("B")]); // cursor=2

    expect(buffer.delete()).toBe(true);

    expect(buffer.items).toEqual([a]);
    expect(buffer.cursor).toBe(1);
  });

  // SEED — backspace at start with no selection is a no-op returning false.
  it("delete at buffer start with no selection returns false", () => {
    expect(buffer.delete()).toBe(false);
    expect(buffer.items).toEqual([]);
  });

  // before:  [A, B, C]    anchor=1, cursor=3   selection = [1, 3) → B, C
  // delete()
  // after:   [A]          cursor = anchor = 1  (selection removed, caret at start)
  it("delete with active selection removes it and collapses to start", () => {
    const a = glyph("A");
    buffer.insertMany([a, glyph("B"), glyph("C")]);
    buffer.selectRange(1, 3);

    expect(buffer.delete()).toBe(true);

    expect(buffer.items).toEqual([a]);
    expect(buffer.cursor).toBe(1);
    expect(buffer.anchor).toBe(1);
  });

  // SEED — selectAll spans the whole buffer.
  it("selectAll spans 0..length", () => {
    buffer.insertMany([glyph("A"), glyph("B"), glyph("C")]);

    buffer.selectAll();

    expect(buffer.anchor).toBe(0);
    expect(buffer.cursor).toBe(3);
    expect(buffer.range).toEqual({ start: 0, end: 3 });
  });

  // [A, B] has length 2 → valid positions are [0, 1, 2]
  // placeCaret(99) clamps to length=2; anchor and cursor both land there.
  it("placeCaret clamps and collapses selection", () => {
    buffer.insertMany([glyph("A"), glyph("B")]);
    buffer.selectRange(0, 2);

    buffer.placeCaret(99);

    expect(buffer.cursor).toBe(2);
    expect(buffer.anchor).toBe(2);
    expect(buffer.hasSelection).toBe(false);
  });

  // SEED — snapshot / restore round-trip.
  it("snapshot then restore reproduces buffer state", () => {
    const items = [glyph("A"), glyph("B"), glyph("C")];
    buffer.insertMany(items);
    buffer.selectRange(1, 3);
    buffer.setOriginX(42);

    const snap = buffer.snapshot();

    const fresh = new TextBuffer();
    fresh.restore(snap);

    expect(fresh.items).toEqual(items);
    expect(fresh.anchor).toBe(1);
    expect(fresh.cursor).toBe(3);
    expect(fresh.originX).toBe(42);
  });

  it("itemById follows the same logical item through insertions and deletion", () => {
    const b = glyph("B");
    buffer.insertMany([glyph("A"), b]);

    buffer.placeCaret(0);
    buffer.insert(glyph("X"));

    expect(buffer.itemById(b.id)).toBe(b);

    buffer.selectRange(2, 3);
    buffer.delete();

    expect(buffer.itemById(b.id)).toBeNull();
  });
});
