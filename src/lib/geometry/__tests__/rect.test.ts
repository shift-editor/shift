import { Rect } from "../rect";

describe("Rect", () => {
  describe("initilisation", () => {
    it("with x, y and size", () => {
      const rect = new Rect(10, 10, 100, 100);
    });

    it("from bounds", () => {
      const rect = Rect.fromBounds(10, 20, 30, 30);
    });
  });
});
