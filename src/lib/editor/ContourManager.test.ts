import { ContourManager } from "./ContourManager";

describe("PathManager", () => {
  let pm: ContourManager;
  beforeEach(() => {
    pm = new ContourManager();
  });

  describe("new path manager", () => {
    it("should have one empty path", () => {
      expect(pm.nodes.length).toBe(1);
    });
  });
});
