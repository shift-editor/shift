import { describe, expect, it } from "vitest";
import { colorThemes, type ColorTheme } from "./index";
import { ThemeCatalog } from "./ThemeCatalog";

const fileTheme = (id: string): ColorTheme => ({
  ...colorThemes[0]!,
  id,
  name: id,
  file: `${id}.toml`,
});

describe("ThemeCatalog", () => {
  it("lists shipped themes first, then the user's", () => {
    const user = [fileTheme("rice")];
    const catalog = ThemeCatalog.BUILT_IN.withUser(user);

    expect(catalog.all).toEqual([...colorThemes, ...user]);
    expect(catalog.user).toEqual(user);
    expect(catalog.has("rice")).toBe(true);
  });

  it("falls back to Shift Light for a theme it does not have", () => {
    expect(ThemeCatalog.BUILT_IN.has("missing")).toBe(false);
    expect(ThemeCatalog.BUILT_IN.byId("missing").id).toBe("shift-light");
  });
});
