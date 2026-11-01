import { describe, expect, it } from "vitest";
import type { FontFeature } from "@shift/editor/text";
import { FontFeatures, settingStep } from "./fontFeatures";

/** A feature as the engine lists it. */
function feature(
  tag: string,
  name: string | null,
  defaultSetting: FontFeature["default"],
  group: FontFeature["group"],
): FontFeature {
  return { tag, name, default: defaultSetting, group };
}

const LISTED = [
  feature("ccmp", "Glyph Composition", "required", "other"),
  feature("dlig", "Discretionary Ligatures", "off", "ligatures"),
  feature("liga", "Standard Ligatures", "on", "ligatures"),
  feature("ss01", "Single-storey a", "off", "stylisticSets"),
];

describe("a feature's dot cycles its setting", () => {
  it("moves from the font's default to on, to off, and back", () => {
    const cycle = ["default", "on", "off"] as const;

    expect(cycle.map((setting) => settingStep(setting).next)).toEqual(["on", "off", "default"]);
    expect(cycle.map((setting) => settingStep(setting).override)).toEqual([null, true, false]);
  });

  it("walks the cycle backwards with Alt", () => {
    expect(settingStep("default").previous).toBe("off");
    expect(settingStep("off").previous).toBe("on");
    expect(settingStep("on").previous).toBe("default");
  });

  it("labels the default with what the font does", () => {
    expect(settingStep("default").label(true)).toBe("Default (on)");
    expect(settingStep("default").label(false)).toBe("Default (off)");
    expect(settingStep("off").label(true)).toBe("Off");
  });
});

describe("the Features section lists switchable features under headings", () => {
  const features = FontFeatures.switchable(LISTED);

  it("leaves out the features the shaper always applies, under the groups Rust gives", () => {
    expect(features.grouped()).toEqual([
      { title: "Ligatures", features: [LISTED[1], LISTED[2]] },
      { title: "Stylistic sets", features: [LISTED[3]] },
    ]);
  });

  it("matches a search by tag or by name", () => {
    const tags = (query: string) => features.matching(query).all.map(({ tag }) => tag);

    expect(tags("stand")).toEqual(["liga"]);
    expect(tags("DLIG")).toEqual(["dlig"]);
    expect(tags("storey")).toEqual(["ss01"]);
    expect(tags("  ")).toEqual(["dlig", "liga", "ss01"]);
  });
});
