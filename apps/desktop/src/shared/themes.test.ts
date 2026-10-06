import { describe, expect, it } from "vitest";
import { parseBase16Scheme, parseColorTheme, serializeBase16Scheme, userThemeSlug } from "./themes";

const classicGruvbox = {
  scheme: "Gruvbox dark, medium",
  author: "Dawid Kurek",
  base00: "282828",
  base01: "3c3836",
  base02: "504945",
  base03: "665c54",
  base04: "bdae93",
  base05: "d5c4a1",
  base06: "ebdbb2",
  base07: "fbf1c7",
  base08: "fb4934",
  base09: "fe8019",
  base0A: "fabd2f",
  base0B: "b8bb26",
  base0C: "8ec07c",
  base0D: "83a598",
  base0E: "d3869b",
  base0F: "d65d0e",
};

describe("Base16 scheme files become color themes", () => {
  it("reads a classic scheme and infers its appearance from the background", () => {
    const theme = parseBase16Scheme(classicGruvbox, "user:gruvbox");

    expect(theme?.name).toBe("Gruvbox dark, medium");
    expect(theme?.appearance).toBe("dark");
    expect(theme?.palette.base0D).toBe("#83a598");
  });

  it("reads a Tinted Theming scheme and honors its variant", () => {
    const { scheme: _scheme, author: _author, ...colors } = classicGruvbox;
    const palette = Object.fromEntries(
      Object.entries(colors).map(([key, color]) => [key, `#${color.toUpperCase()}`]),
    );
    const theme = parseBase16Scheme(
      { system: "base16", name: "Odd", variant: "light", palette },
      "user:odd",
    );

    expect(theme?.appearance).toBe("light");
    expect(theme?.palette.base00).toBe("#282828");
  });

  it("rejects a scheme missing a color or holding a malformed one", () => {
    const { base0F: _missing, ...incomplete } = classicGruvbox;

    expect(parseBase16Scheme(incomplete, "user:x")).toBeNull();
    expect(parseBase16Scheme({ ...classicGruvbox, base03: "#66c" }, "user:x")).toBeNull();
    expect(parseBase16Scheme("base00: 282828", "user:x")).toBeNull();
  });

  it("round-trips a theme through its serialized scheme", () => {
    const theme = parseBase16Scheme(classicGruvbox, "user:gruvbox");
    if (!theme) throw new Error("Expected a theme");

    expect(parseBase16Scheme(serializeBase16Scheme(theme), theme.id)).toEqual(theme);
    expect(parseColorTheme(theme)).toEqual(theme);
  });
});

describe("user theme ids map to safe file names", () => {
  it("accepts user ids and refuses built-in ids or path traversal", () => {
    expect(userThemeSlug("user:my-theme")).toBe("my-theme");
    expect(userThemeSlug("nord")).toBeNull();
    expect(userThemeSlug("user:../secrets")).toBeNull();
    expect(userThemeSlug("user:nested/theme")).toBeNull();
  });
});
