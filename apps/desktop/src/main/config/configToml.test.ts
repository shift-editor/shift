import { describe, expect, it } from "vitest";
import { readConfig, setConfigTheme } from "./configToml";

describe("readConfig", () => {
  it("reads the theme", () => {
    expect(readConfig(`theme = "nord"\n`)).toEqual({ values: { theme: "nord" }, problems: [] });
  });

  it("reads an empty file as choosing no theme", () => {
    expect(readConfig("")).toEqual({ values: { theme: null }, problems: [] });
  });

  it("reports a syntax error with its location and applies nothing", () => {
    const read = readConfig(`# rice\ntheme = "nord\n`);

    expect(read.values).toBeNull();
    expect(read.problems).toHaveLength(1);
    expect(read.problems[0]).toMatchObject({ severity: "error", line: 2 });
    expect(read.problems[0].message).not.toContain("\n");
  });

  it("rejects a theme that is not a string, at its line", () => {
    const read = readConfig(`\ntheme = 3\n`);

    expect(read.values).toBeNull();
    expect(read.problems).toEqual([
      expect.objectContaining({ severity: "error", line: 2, column: 1 }),
    ]);
  });

  it("warns about unknown keys but still applies the known ones", () => {
    const read = readConfig(`theme = "nord"\nacent = "#fff"\n["weird.(key"]\n`);

    expect(read.values).toEqual({ theme: "nord" });
    expect(
      read.problems.map(({ severity, message, line }) => ({ severity, message, line })),
    ).toEqual([
      { severity: "warning", message: `Unknown setting "acent" is ignored.`, line: 2 },
      { severity: "warning", message: `Unknown setting "weird.(key" is ignored.`, line: null },
    ]);
  });
});

describe("setConfigTheme", () => {
  it("creates a file with only the theme", () => {
    expect(setConfigTheme(null, "nord")).toBe(`theme = "nord"\n`);
  });

  it("changes only the theme value, keeping comments and layout", () => {
    const source = [
      "# My rice",
      `theme   =   "dracula"   # was nord`,
      "",
      "[future]",
      `theme = "not-top-level"`,
      "",
    ].join("\n");

    expect(setConfigTheme(source, "gruvbox-dark")).toBe(
      source.replace(`"dracula"`, `"gruvbox-dark"`),
    );
  });

  it("replaces literal and quoted-key forms", () => {
    expect(setConfigTheme(`"theme" = 'nord'\n`, "system")).toBe(`"theme" = "system"\n`);
  });

  it("keeps a # inside the old value from being read as a comment", () => {
    expect(setConfigTheme(`theme = "a#b" # note\n`, "nord")).toBe(`theme = "nord" # note\n`);
  });

  it("adds a missing theme before the first table", () => {
    const source = "# header\n\n[future]\nkey = 1\n";

    expect(setConfigTheme(source, "nord")).toBe(
      `# header\n\ntheme = "nord"\n\n[future]\nkey = 1\n`,
    );
  });

  it("appends a missing theme to a file without tables", () => {
    expect(setConfigTheme("# just a comment", "nord")).toBe(`# just a comment\ntheme = "nord"\n`);
  });

  it("refuses a theme written as a multi-line string", () => {
    expect(() => setConfigTheme(`theme = """\nnord"""\n`, "dracula")).toThrow(/edit it by hand/);
  });

  it("refuses a file that does not parse", () => {
    expect(() => setConfigTheme(`theme = "nord`, "dracula")).toThrow();
  });
});
