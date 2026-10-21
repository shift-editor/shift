import { describe, expect, it } from "vitest";

import { TOOLBAR_DOCK_STORAGE_KEY, readToolbarDock, writeToolbarDock } from "./useToolbarDock";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("the toolbar remembers which edge it was left on", () => {
  it("restores a saved dock", () => {
    const storage = memoryStorage();
    writeToolbarDock(storage, "left");

    expect(readToolbarDock(storage)).toBe("left");
  });

  it("defaults to the bottom edge when nothing usable is stored", () => {
    expect(readToolbarDock(memoryStorage())).toBe("bottom");
    expect(readToolbarDock(memoryStorage({ [TOOLBAR_DOCK_STORAGE_KEY]: "middle" }))).toBe("bottom");
  });

  it("carries on when storage refuses to read or write", () => {
    const broken = {
      getItem: (): string | null => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };

    expect(readToolbarDock(broken)).toBe("bottom");
    expect(() => writeToolbarDock(broken, "top")).not.toThrow();
  });
});
