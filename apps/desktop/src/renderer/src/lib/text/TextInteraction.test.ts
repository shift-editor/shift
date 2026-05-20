import { describe, it, expect, beforeEach } from "vitest";
import { TextInteraction } from "./TextInteraction";
import { glyphTextItem as glyph } from "./layout";

describe("TextInteraction", () => {
  let ctx: TextInteraction;

  beforeEach(() => {
    ctx = new TextInteraction();
  });

  it("starts with everything null", () => {
    expect(ctx.editing).toBeNull();
    expect(ctx.suspended).toBeNull();
    expect(ctx.hoveredIndex).toBeNull();
  });

  it("setEditing stores the target", () => {
    const target = { index: 3, item: glyph("A", 65) };
    ctx.setEditing(target);

    expect(ctx.editing).toEqual(target);
  });

  it("suspend moves editing into suspended", () => {
    const target = { index: 3, item: glyph("A", 65) };
    ctx.setEditing(target);

    ctx.suspend();

    expect(ctx.editing).toBeNull();
    expect(ctx.suspended).toEqual(target);
  });

  it("resume moves suspended back to editing and returns it", () => {
    const target = { index: 3, item: glyph("A", 65) };
    ctx.setEditing(target);
    ctx.suspend();

    const restored = ctx.resume();

    expect(restored).toEqual(target);
    expect(ctx.editing).toEqual(target);
    expect(ctx.suspended).toBeNull();
  });

  it("resume with nothing suspended returns null", () => {
    expect(ctx.resume()).toBeNull();
    expect(ctx.editing).toBeNull();
  });

  it("clear resets everything to null", () => {
    ctx.setEditing({ index: 1, item: glyph("X") });
    ctx.suspend();
    ctx.setEditing({ index: 2, item: glyph("Y") });
    ctx.setHovered(7);

    ctx.clear();

    expect(ctx.editing).toBeNull();
    expect(ctx.suspended).toBeNull();
    expect(ctx.hoveredIndex).toBeNull();
  });

  // before:  [_, _, _, _, X, _, _, _]    editing.index = 4 (X)
  //                       └─delete─┘     at=3, count=3 → deletes indices 3,4,5
  // after:   [_, _, _, _, _]              editing → null  (X was inside)
  it("adjustForBufferChange nulls indices inside the deleted range", () => {
    ctx.setEditing({ index: 4, item: glyph("A") });
    ctx.adjustForBufferChange(3, 3, 0);

    expect(ctx.editing).toBeNull();
  });

  // before:  [_, _, _, _, _, _, _, X]    editing.index = 7 (X)
  //                └─delete─┘             at=2, count=3 → deletes indices 2,3,4
  // after:   [_, _, _, _, X]              editing.index = 4  (shifted left by 3)
  it("adjustForBufferChange shifts indices after a deletion", () => {
    ctx.setEditing({ index: 7, item: glyph("A") });
    ctx.adjustForBufferChange(2, 3, 0);

    expect(ctx.editing?.index).toBe(4);
  });

  // before:  [_, _, _, _, _, X]          editing.index = 5 (X)
  //                    ↑                  insert 2 items at index 3
  // after:   [_, _, _, ?, ?, _, _, X]    editing.index = 7  (shifted right by 2)
  it("adjustForBufferChange shifts indices at or after an insertion", () => {
    ctx.setEditing({ index: 5, item: glyph("A") });
    ctx.adjustForBufferChange(3, 0, 2);

    expect(ctx.editing?.index).toBe(7);
  });

  it("snapshot then restore reproduces context state", () => {
    const suspended = { index: 4, item: glyph("A", 65) };
    const editing = { index: 1, item: glyph("B", 66) };
    ctx.setEditing(suspended);
    ctx.suspend();
    ctx.setEditing(editing);
    ctx.setHovered(3);

    const snap = ctx.snapshot();

    const fresh = new TextInteraction();
    fresh.restore(snap);

    expect(fresh.editing).toEqual(editing);
    expect(fresh.suspended).toEqual(suspended);
    expect(fresh.hoveredIndex).toBe(3);
  });
});
