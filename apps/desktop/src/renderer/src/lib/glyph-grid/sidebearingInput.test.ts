import { describe, expect, it } from "vitest";
import { readSidebearingInput } from "./sidebearingInput";

const anyKey = () => null;
const edit = (text: string) => readSidebearingInput(text, anyKey);

describe("reading a Set Sidebearings field", () => {
  it("leaves the side alone when blank", () => {
    expect(edit("  ")).toEqual({ kind: "edit", edit: { kind: "keep" } });
  });

  it("sets on a bare number and adjusts on a signed one", () => {
    expect(edit("40")).toEqual({ kind: "edit", edit: { kind: "set", set: 40 } });
    expect(edit(" 12.5 ")).toEqual({ kind: "edit", edit: { kind: "set", set: 12.5 } });
    expect(edit("+10")).toEqual({ kind: "edit", edit: { kind: "adjust", adjust: 10 } });
    expect(edit("-10")).toEqual({ kind: "edit", edit: { kind: "adjust", adjust: -10 } });
    expect(edit("−10")).toEqual({ kind: "edit", edit: { kind: "adjust", adjust: -10 } });
  });

  it("links on a key the font can read and reports one it cannot", () => {
    expect(edit("=n+10")).toEqual({ kind: "edit", edit: { kind: "link", link: "=n+10" } });
    expect(readSidebearingInput("=n+", () => "expected a value after +")).toEqual({
      kind: "invalid",
      problem: "expected a value after +",
    });
  });

  it("rejects anything else", () => {
    expect(edit("wide")).toMatchObject({ kind: "invalid" });
    expect(edit("1e3")).toMatchObject({ kind: "invalid" });
    expect(edit("+")).toMatchObject({ kind: "invalid" });
  });
});
