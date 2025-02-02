import { Path } from "../../core/Path";

describe("Path", () => {
  let path: Path;

  beforeEach(() => {
    path = new Path();
  });

  it("should create a new path", () => {
    expect(path).toBeDefined();
  });
});
