import { describe, it, expect } from "vitest";
import { GapBuffer } from "./GapBuffer";

describe("GapBuffer", () => {
  it("starts empty", () => {
    const buf = GapBuffer.create();
    expect(buf.length).toBe(0);
    expect(buf.cursorPosition).toBe(0);
    expect(buf.getText()).toEqual([]);
  });

  it("inserts codepoints at cursor", () => {
    const buf = GapBuffer.create();
    buf.insert(65); // A
    buf.insert(66); // B
    buf.insert(67); // C
    expect(buf.getText()).toEqual([65, 66, 67]);
    expect(buf.length).toBe(3);
    expect(buf.cursorPosition).toBe(3);
  });

  it("deletes character before cursor (backspace)", () => {
    const buf = GapBuffer.create();
    buf.insert(65);
    buf.insert(66);
    buf.insert(67);

    expect(buf.delete()).toBe(true);
    expect(buf.getText()).toEqual([65, 66]);
    expect(buf.cursorPosition).toBe(2);
  });

  it("delete at beginning returns false", () => {
    const buf = GapBuffer.create();
    expect(buf.delete()).toBe(false);

    buf.insert(65);
    buf.moveLeft();
    expect(buf.delete()).toBe(false);
    expect(buf.getText()).toEqual([65]);
  });

  it("moves cursor left and right", () => {
    const buf = GapBuffer.create();
    buf.insert(65);
    buf.insert(66);
    buf.insert(67);

    expect(buf.moveLeft()).toBe(true);
    expect(buf.cursorPosition).toBe(2);

    expect(buf.moveLeft()).toBe(true);
    expect(buf.cursorPosition).toBe(1);

    expect(buf.moveRight()).toBe(true);
    expect(buf.cursorPosition).toBe(2);

    // Text unchanged after moves
    expect(buf.getText()).toEqual([65, 66, 67]);
  });

  it("moveLeft at beginning returns false", () => {
    const buf = GapBuffer.create();
    expect(buf.moveLeft()).toBe(false);
  });

  it("moveRight at end returns false", () => {
    const buf = GapBuffer.create();
    buf.insert(65);
    expect(buf.moveRight()).toBe(false);
  });

  it("moveTo positions cursor at requested index", () => {
    const buf = GapBuffer.from([65, 66, 67, 68]);
    buf.moveTo(2);
    expect(buf.cursorPosition).toBe(2);

    buf.moveTo(0);
    expect(buf.cursorPosition).toBe(0);

    buf.moveTo(4);
    expect(buf.cursorPosition).toBe(4);
  });

  it("moveTo clamps out-of-range indices", () => {
    const buf = GapBuffer.from([65, 66, 67]);
    buf.moveTo(99);
    expect(buf.cursorPosition).toBe(3);

    buf.moveTo(-5);
    expect(buf.cursorPosition).toBe(0);
  });

  it("inserts in the middle after moving cursor", () => {
    const buf = GapBuffer.create();
    buf.insert(65); // A
    buf.insert(67); // C
    buf.moveLeft(); // cursor between A and C
    buf.insert(66); // B

    expect(buf.getText()).toEqual([65, 66, 67]);
  });

  it("deletes in the middle", () => {
    const buf = GapBuffer.create();
    buf.insert(65);
    buf.insert(66);
    buf.insert(67);
    buf.moveLeft(); // cursor before C
    buf.delete(); // delete B

    expect(buf.getText()).toEqual([65, 67]);
    expect(buf.cursorPosition).toBe(1);
  });

  it("clear resets buffer", () => {
    const buf = GapBuffer.create();
    buf.insert(65);
    buf.insert(66);
    buf.clear();

    expect(buf.length).toBe(0);
    expect(buf.cursorPosition).toBe(0);
    expect(buf.getText()).toEqual([]);
  });

  it("from() creates buffer with initial codepoints", () => {
    const buf = GapBuffer.from([65, 66, 67]);
    expect(buf.getText()).toEqual([65, 66, 67]);
    expect(buf.length).toBe(3);
    expect(buf.cursorPosition).toBe(3);
  });

  it("from() with cursor position", () => {
    const buf = GapBuffer.from([65, 66, 67], 1);
    expect(buf.getText()).toEqual([65, 66, 67]);
    expect(buf.cursorPosition).toBe(1);
  });

  it("handles growing when capacity is exceeded", () => {
    const buf = GapBuffer.create(2);
    for (let i = 0; i < 10; i++) {
      buf.insert(65 + i);
    }
    expect(buf.length).toBe(10);
    expect(buf.getText()).toEqual([65, 66, 67, 68, 69, 70, 71, 72, 73, 74]);
  });
});
