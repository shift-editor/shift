import { Contour } from "@/lib/core/Contour";

describe("Contour", () => {
  let contour: Contour;

  beforeEach(() => {
    contour = new Contour();
  });

  it("should create a contour", () => {
    expect(contour).toBeDefined();
  });
});
