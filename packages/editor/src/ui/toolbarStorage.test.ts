import { describe, expect, it } from "vitest";
import type { ToolbarStorage } from "../types/toolbar";
import { TOOLBAR_STORAGE_KEY, readToolbarDock, writeToolbarDock } from "./toolbarStorage";

function memoryStorage(initial: Record<string, string> = {}): ToolbarStorage {
  const values = new Map(Object.entries(initial));

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("the toolbar remembers which edge it was left on", () => {
  it("restores a saved dock", () => {
    const storage = memoryStorage();
    writeToolbarDock("left", storage);

    expect(readToolbarDock(storage)).toBe("left");
  });

  it("defaults to the bottom edge when nothing usable is stored", () => {
    expect(readToolbarDock(memoryStorage())).toBe("bottom");
    expect(readToolbarDock(memoryStorage({ [TOOLBAR_STORAGE_KEY]: "middle" }))).toBe("bottom");
    expect(readToolbarDock(null)).toBe("bottom");
  });

  it("carries on when storage refuses to read or write", () => {
    const broken: ToolbarStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };

    expect(readToolbarDock(broken)).toBe("bottom");
    expect(() => writeToolbarDock("top", broken)).not.toThrow();
  });
});
