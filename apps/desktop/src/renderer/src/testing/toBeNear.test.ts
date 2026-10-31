import { describe, expect, it } from "vitest";

describe("toBeNear", () => {
  it("passes a position that rounds to the expected one at the digits given", () => {
    expect({ x: 186.604, y: 149.996 }).toBeNear({ x: 186.6, y: 150 });
    expect({ x: 186.6, y: 150 }).not.toBeNear({ x: 186.61, y: 150 });
    expect({ x: 1.0004, y: 2 }).toBeNear({ x: 1, y: 2 }, 3);
    expect({ x: 1.0006, y: 2 }).not.toBeNear({ x: 1, y: 2 }, 3);
  });

  it("fails anything that is not a position", () => {
    expect(null).not.toBeNear({ x: 0, y: 0 });
    expect({ x: "0", y: 0 }).not.toBeNear({ x: 0, y: 0 });
  });

  it("matches a position nested in what another matcher compares", () => {
    expect({ to: { x: 99.999, y: 0 } }).toEqual({ to: expect.toBeNear({ x: 100, y: 0 }) });
  });

  it("says what it was given and what it expected", () => {
    expect(() => expect({ x: 1, y: 2 }).toBeNear({ x: 3, y: 4 })).toThrow(
      "expected { x: 1, y: 2 } to be near { x: 3, y: 4 } (2 decimal places)",
    );
  });
});
