import { beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { RunId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";
import { featureSetting, FontFeatures, settingStep } from "./fontFeatures";

const SHAPING_TEST = resolve(process.cwd(), "../../fixtures/fonts/ShapingTest.ufo");

describe("a feature's dot cycles its setting in the text", () => {
  let editor: TestEditor;
  let runId: RunId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    runId = editor.text.createRun(editor.text.itemsFromText("fi")).id;
  });

  const names = () =>
    editor.text
      .layoutCell(runId)
      .peek()
      ?.placedGlyphs.map((placed) => placed.glyph.glyphName) ?? [];

  /** Clicks liga's dot, or Alt-clicks it with `reverse`, and returns the setting it lands on. */
  const click = (reverse = false) => {
    const current = settingStep(featureSetting(editor.text.run(runId)!, "liga"));
    const next = reverse ? current.previous : current.next;
    editor.history.capture("Set liga", () =>
      editor.text.setFeature(runId, "liga", settingStep(next).override),
    );
    return featureSetting(editor.text.run(runId)!, "liga");
  };

  it("moves from the font's default to on, to off, and back", async () => {
    await expect.poll(names).toEqual(["f_i"]);

    expect(click()).toBe("on");
    expect(names()).toEqual(["f_i"]);
    expect(click()).toBe("off");
    expect(names()).toEqual(["f", "i"]);
    expect(click()).toBe("default");
    expect(names()).toEqual(["f_i"]);
  });

  it("walks the cycle backwards with Alt", async () => {
    await expect.poll(names).toEqual(["f_i"]);

    expect(click(true)).toBe("off");
    expect(names()).toEqual(["f", "i"]);
    expect(click(true)).toBe("on");
    expect(click(true)).toBe("default");
  });

  it("labels the default with what the font does", () => {
    expect(settingStep("default").label(true)).toBe("Default (on)");
    expect(settingStep("default").label(false)).toBe("Default (off)");
    expect(settingStep("off").label(true)).toBe("Off");
  });
});

describe("the Features section lists switchable features under headings", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    editor.text.createRun(editor.text.itemsFromText("fi"));
  });

  const features = async () => {
    await expect.poll(() => editor.text.featuresCell.peek().length).toBe(7);
    return FontFeatures.switchable(editor.text.featuresCell.peek());
  };

  it("leaves out the features the shaper always applies", async () => {
    const titles = (await features())
      .grouped()
      .map((group) => [group.title, group.features.map((feature) => feature.tag)]);

    expect(titles).toEqual([["Ligatures", ["dlig", "liga"]]]);
  });

  it("matches a search by tag or by name", async () => {
    const all = await features();
    const tags = (query: string) => all.matching(query).all.map((feature) => feature.tag);

    expect(tags("stand")).toEqual(["liga"]);
    expect(tags("DLIG")).toEqual(["dlig"]);
    expect(tags("  ")).toEqual(["dlig", "liga"]);
  });
});
