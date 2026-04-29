import { describe, it, expect, beforeEach } from "vitest";
import { TextBuffer } from "./TextBuffer";
import { glyphCell as glyph } from "./layout";

describe("TextBuffer", () => {
  let buffer: TextBuffer;

  beforeEach(() => {
    buffer = new TextBuffer();
  });

  // SEED — fresh buffer is empty with cursor at 0.
  it("starts empty", () => {
    expect(buffer.cells).toEqual([]);
    expect(buffer.length).toBe(0);
    expect(buffer.cursor).toBe(0);
    expect(buffer.anchor).toBe(0);
    expect(buffer.hasSelection).toBe(false);
  });

  // SEED — insert appends and advances cursor + anchor.
  it("insert places cell at cursor and advances both cursor and anchor", () => {
    buffer.insert(glyph("A"));

    expect(buffer.cells).toEqual([glyph("A")]);
    expect(buffer.cursor).toBe(1);
    expect(buffer.anchor).toBe(1);
    expect(buffer.hasSelection).toBe(false);
  });

  // before:  [A, B, C]    anchor=1, cursor=3   selection = [1, 3) → B, C
  // insert(X)
  // after:   [A, X]       cursor = anchor = 2  (X collapses BC + caret advances)
  it("insert replaces an active selection", () => {
    buffer.insertMany([glyph("A"), glyph("B"), glyph("C")]);
    buffer.selectRange(1, 3);

    buffer.insert(glyph("X"));

    expect(buffer.cells).toEqual([glyph("A"), glyph("X")]);
    expect(buffer.cursor).toBe(2);
    expect(buffer.anchor).toBe(2);
  });

  // SEED — backspace with no selection removes one cell before cursor.
  it("delete removes cell before cursor when there is no selection", () => {
    buffer.insertMany([glyph("A"), glyph("B")]); // cursor=2

    expect(buffer.delete()).toBe(true);

    expect(buffer.cells).toEqual([glyph("A")]);
    expect(buffer.cursor).toBe(1);
  });

  // SEED — backspace at start with no selection is a no-op returning false.
  it("delete at buffer start with no selection returns false", () => {
    expect(buffer.delete()).toBe(false);
    expect(buffer.cells).toEqual([]);
  });

  // before:  [A, B, C]    anchor=1, cursor=3   selection = [1, 3) → B, C
  // delete()
  // after:   [A]          cursor = anchor = 1  (selection removed, caret at start)
  it("delete with active selection removes it and collapses to start", () => {
    buffer.insertMany([glyph("A"), glyph("B"), glyph("C")]);
    buffer.selectRange(1, 3);

    expect(buffer.delete()).toBe(true);

    expect(buffer.cells).toEqual([glyph("A")]);
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
    buffer.insertMany([glyph("A"), glyph("B"), glyph("C")]);
    buffer.selectRange(1, 3);
    buffer.setOriginX(42);

    const snap = buffer.snapshot();

    const fresh = new TextBuffer();
    fresh.restore(snap);

    expect(fresh.cells).toEqual([glyph("A"), glyph("B"), glyph("C")]);
    expect(fresh.anchor).toBe(1);
    expect(fresh.cursor).toBe(3);
    expect(fresh.originX).toBe(42);
  });
});
