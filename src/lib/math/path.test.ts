import { Contour } from "@/lib/core/Contour";

describe("Path", () => {
  let path: Contour;

  beforeEach(() => {
    path = new Contour();
  });

  it("should create a new path", () => {
    expect(path).toBeDefined();
  });
});
