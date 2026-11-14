import { describe, expect, it } from "vitest";
import { childPath, folderBreadcrumb, parentFolder, pathName } from "./exportPaths";

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
