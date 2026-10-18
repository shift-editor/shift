import { describe, it } from "vitest";
import { Mat } from "@shift/geo";
import { composeTransform, decomposeMatrix, transformPoint } from "@shift/wasm/reference";
import {
  expectDecomposedClose,
  expectMatricesClose,
  expectNumbersClose,
  matrixCases,
  transformCases,
} from "../../testing/reference";

const transforms = transformCases();
const point = { x: 37.5, y: -82.25 };
const POINT_LABELS = ["x", "y"];

describe("component matrices match shift-font's DecomposedTransform", () => {
  it.each(transforms)("composes $name like to_matrix", (testCase) => {
    const { transform } = testCase;

    expectMatricesClose(Mat.fromDecomposed(transform), composeTransform(transform), testCase);
  });

  it.each(transforms)("maps a point through $name like transform_point", (testCase) => {
    const mapped = Mat.applyToPoint(Mat.fromDecomposed(testCase.transform), point);
    const expected = transformPoint(testCase.transform, point);

    expectNumbersClose(
      [mapped.x, mapped.y],
      [expected.x, expected.y],
      { ...testCase, point },
      {
        labels: POINT_LABELS,
      },
    );
  });

  // Decomposing what Rust composed covers matrices that came from a placement.
  const matrices = [
    ...matrixCases(),
    ...transforms.map(({ name, transform }) => ({
      name: `composed ${name}`,
      matrix: composeTransform(transform),
    })),
  ];

  it.each(matrices)("decomposes $name like from_matrix", (testCase) => {
    const { matrix } = testCase;

    expectDecomposedClose(Mat.toDecomposed(matrix), decomposeMatrix(matrix), testCase);
  });
});
