import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { GlyphName } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

const SHAPING_TEST = resolve(process.cwd(), "../../fixtures/fonts/ShapingTest.ufo");
const CODE = "feature liga { sub f i by f_x; } liga;\n";

const rules = async (editor: TestEditor) =>
  (await editor.font.lintFeatureCode(CODE)).map((diagnostic) => diagnostic.rule);

describe("feature code is linted against the open font", () => {
  it("stops reporting a glyph once the font has it", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    expect(await rules(editor)).toContain("G001");

    editor.history.capture("Add glyph", () => editor.font.createGlyph("f_x" as GlyphName));
    await editor.settle();

    expect(await rules(editor)).not.toContain("G001");
  });

  it("ignoring a rule is an edit that undo takes back", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    const settings = await editor.font.featureCodeSettings();

    editor.history.capture("Ignore G001", () =>
      editor.font.setFeatureCodeSettings({
        ...settings,
        ignoredRules: ["G001"],
      }),
    );
    expect(await rules(editor)).not.toContain("G001");

    await editor.undo();
    expect(await rules(editor)).toContain("G001");
    expect((await editor.font.featureCodeSettings()).ignoredRules).toEqual([]);
  });
});

describe("feature code names lead to where they are defined", () => {
  const source = "@lc = [f i];\nfeature smcp { sub @lc by @lc; } smcp;\n";
  const use = source.indexOf("@lc by") + 1;

  it("finds a class's definition from a use, and renames every occurrence", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");

    const symbol = await editor.font.featureSymbolAt(source, use);
    const edits = await editor.font.renameFeatureSymbol(source, use, "lower");

    expect(symbol?.kind).toBe("class");
    expect(symbol?.definitions).toEqual([{ from: 0, to: 3 }]);
    expect(symbol?.references).toHaveLength(2);
    expect(edits?.map((edit) => source.slice(edit.from, edit.to))).toEqual(["@lc", "@lc", "@lc"]);
    expect(await editor.font.renameFeatureSymbol(source, use, "1bad")).toBeNull();
  });

  it("knows a glyph name as a glyph, which the canvas can open", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");

    const symbol = await editor.font.featureSymbolAt(source, source.indexOf("i]"));

    expect(symbol).toMatchObject({ kind: "glyph", name: "i" });
    expect(editor.font.entryForName("i" as GlyphName)).not.toBeNull();
  });
});
