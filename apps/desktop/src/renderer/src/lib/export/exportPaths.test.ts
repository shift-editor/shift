import { describe, expect, it } from "vitest";
import { childPath, folderBreadcrumb, middleCut, parentFolder, pathName } from "./exportPaths";

describe("export paths keep the separator main gave them", () => {
  it("reads and builds POSIX paths", () => {
    expect(pathName("/type/Solenoid/Solenoid-5×7.ufo")).toBe("Solenoid-5×7.ufo");
    expect(parentFolder("/type/Solenoid/Solenoid.shift")).toBe("/type/Solenoid");
    expect(childPath("/type/Solenoid", "fonts")).toBe("/type/Solenoid/fonts");
    expect(folderBreadcrumb("/type/Solenoid/fonts")).toEqual(["Solenoid", "fonts"]);
  });

  it("reads and builds Windows paths", () => {
    expect(parentFolder("C:\\type\\Solenoid\\Solenoid.shift")).toBe("C:\\type\\Solenoid");
    expect(childPath("C:\\type\\Solenoid", "fonts")).toBe("C:\\type\\Solenoid\\fonts");
    expect(folderBreadcrumb("C:\\type\\Solenoid\\fonts")).toEqual(["Solenoid", "fonts"]);
  });
});

describe("a long file name is cut in the middle", () => {
  const within = (limit: number) => (text: string) => text.length <= limit;

  it("leaves a name that fits", () => {
    expect(middleCut("MutatorMathTest-One.ttf", within(30))).toBe("MutatorMathTest-One.ttf");
  });

  it("keeps the instance and extension whole and shortens the start", () => {
    expect(middleCut("MutatorMathTest-LightCondensed.ttf", within(27))).toBe(
      "Mutator…-LightCondensed.ttf",
    );
  });

  it("keeps the extension of a name without a dash", () => {
    expect(middleCut("MutatorMathTest[wdth,wght].ttf", within(12))).toBe("Mutator….ttf");
  });
});
