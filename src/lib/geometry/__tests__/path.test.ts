import { Path } from "../path";

describe("Path", () => {
  let path: Path;

  beforeEach(() => {
    path = new Path();
  });

  describe("initialization", () => {
    it("should start empty", () => {
      expect(path.isEmpty()).toBe(true);
      expect(path.numberOfSegments).toBe(0);
    });
  });
});
