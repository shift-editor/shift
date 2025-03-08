import { ContourManager } from "./ContourManager";

describe("ContourManager", () => {
  let cm: ContourManager;
  beforeEach(() => {
    cm = new ContourManager();
  });

  describe("new contour manager", () => {
    it("should have one empty contour", () => {
      expect(cm.nodes().length).toBe(1);
    });
  });
});
