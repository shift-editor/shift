import { PathManager } from "./PathManager";

describe("PathManager", () => {
  let pm: PathManager;
  beforeEach(() => {
    pm = new PathManager();
  });

  describe("new path manager", () => {
    it("should have one empty path", () => {
      expect(pm.paths.length).toBe(1);
    });
  });
});
