import { describe, it } from "vitest";
import { Mat, type MatModel } from "@shift/geo";
import {
  asAnchorId,
  asComponentId,
  asContourId,
  asGlyphId,
  asLayerId,
  asPointId,
  type GlyphState,
  type PointType,
} from "@shift/types";
import {
  between,
  expectBoundsClose,
  REFERENCE_SEED,
  seededRandom,
  type Random,
} from "../../testing/reference";
import { transformLayer } from "@shift/wasm/reference";
import { LayerBuffers } from "./LayerBuffers";

const POINT_TYPES: readonly PointType[] = ["onCurve", "offCurve", "qCurve"];

interface LayerCase {
  readonly name: string;
  readonly state: GlyphState;
  readonly matrix: MatModel;
}

type ContourSpec = readonly [
  closed: boolean,
  points: readonly (readonly [number, number, PointType])[],
];

/** Builds a layer state from contours, anchor positions, and component placements. */
function layerState(
  contours: readonly ContourSpec[],
  anchors: readonly (readonly [number, number])[],
  components: readonly (readonly number[])[],
): GlyphState {
  let nextPoint = 0;
  const structure = {
    contours: contours.map(([closed, points], index) => ({
      id: asContourId(`contour-${index}`),
      closed,
      points: points.map(([, , pointType]) => ({
        id: asPointId(`point-${nextPoint++}`),
        pointType,
        smooth: false,
      })),
    })),
    anchors: anchors.map((_, index) => ({ id: asAnchorId(`anchor-${index}`), name: `a${index}` })),
    components: components.map((_, index) => ({
      id: asComponentId(`component-${index}`),
      baseGlyphId: asGlyphId("base"),
      baseGlyphName: "base",
    })),
  };
  const values = [
    600,
    ...contours.flatMap(([, points]) => points.flatMap(([x, y]) => [x, y])),
    ...anchors.flat(),
    ...components.flat(),
  ];

  return { layerId: asLayerId("reference"), structure, values: new Float64Array(values) };
}

const placement = (
  translate: readonly [number, number],
  rotation: number,
  scale: readonly [number, number],
  skew: readonly [number, number],
  center: readonly [number, number],
): number[] => [...translate, rotation, ...scale, ...skew, ...center];

/** A layer with a closed cubic outline, an open line, a quadratic loop, two anchors, and placed components. */
const sampleLayer = layerState(
  [
    [
      true,
      [
        [250, 0, "onCurve"],
        [388.5, 0, "offCurve"],
        [500, 111.5, "offCurve"],
        [500, 250, "onCurve"],
        [420, 520, "onCurve"],
        [80, 520, "onCurve"],
      ],
    ],
    [
      false,
      [
        [40, -30, "onCurve"],
        [160, 90.25, "onCurve"],
      ],
    ],
    [
      true,
      [
        [300, 300, "onCurve"],
        [360, 240, "offCurve"],
        [420, 300, "qCurve"],
        [360, 380, "offCurve"],
      ],
    ],
  ],
  [
    [250, 700],
    [-12.5, -3.75],
  ],
  [
    placement([0, 0], 0, [1, 1], [0, 0], [0, 0]),
    placement([140, 0], 0, [1, 1], [0, 0], [0, 0]),
    placement([20, 30], 25, [1, 1], [0, 0], [100, 200]),
    placement([0, 0], 0, [-1, 1], [0, 0], [0, 0]),
    placement([7, -9], -40, [0.7, 1.3], [10, 0], [0, 0]),
  ],
);

/** `inner` applied about `center`. */
function about(center: readonly [number, number], inner: MatModel): MatModel {
  return Mat.Compose(
    Mat.Compose(Mat.Translate(center[0], center[1]), inner),
    Mat.Translate(-center[0], -center[1]),
  );
}

const center = [250, 260] as const;
const namedMatrices: readonly (readonly [string, MatModel])[] = [
  ["translation", Mat.Translate(35.5, -12)],
  ["uniform scale about center", about(center, Mat.Scale(1.5, 1.5))],
  ["non-uniform scale about corner", about([0, 520], Mat.Scale(0.6, 1.8))],
  ["rotation 90", Mat.Rotate(Math.PI / 2)],
  ["rotation about center", about(center, Mat.Rotate((-33 * Math.PI) / 180))],
  ["horizontal flip about center", about(center, Mat.Scale(-1, 1))],
  ["vertical flip", Mat.Scale(1, -1)],
  ["skew", { a: 1, b: 0, c: 0.25, d: 1, e: 0, f: 0 }],
  ["collapse to zero width", about(center, Mat.Scale(0, 1))],
  ["collapse to zero height", about(center, Mat.Scale(1, 0))],
  ["collapse to a point", { a: 0, b: 0, c: 0, d: 0, e: 10, f: 20 }],
];

function randomMatrix(random: Random): MatModel {
  return {
    a: between(random, -2, 2),
    b: between(random, -2, 2),
    c: between(random, -2, 2),
    d: between(random, -2, 2),
    e: between(random, -300, 300),
    f: between(random, -300, 300),
  };
}

function randomLayer(random: Random): GlyphState {
  const coordinate = () => between(random, -500, 500);
  const contours = Array.from(
    { length: 1 + Math.floor(random() * 3) },
    (): ContourSpec => [
      random() < 0.5,
      Array.from({ length: 1 + Math.floor(random() * 6) }, () => [
        coordinate(),
        coordinate(),
        POINT_TYPES[Math.floor(random() * POINT_TYPES.length)]!,
      ]),
    ],
  );
  const anchors = Array.from(
    { length: Math.floor(random() * 3) },
    () => [coordinate(), coordinate()] as const,
  );
  const components = Array.from({ length: Math.floor(random() * 3) }, () =>
    placement(
      [coordinate(), coordinate()],
      between(random, -180, 180),
      [between(random, -2, 2), between(random, -2, 2)],
      [between(random, -30, 30), between(random, -30, 30)],
      [coordinate(), coordinate()],
    ),
  );

  return layerState(contours, anchors, components);
}

function layerCases(sweep = 150): LayerCase[] {
  const cases: LayerCase[] = namedMatrices.map(([name, matrix]) => ({
    name,
    state: sampleLayer,
    matrix,
  }));
  const random = seededRandom(REFERENCE_SEED + 3);
  for (let index = 0; index < sweep; index++) {
    cases.push({
      name: `random layer ${index}`,
      state: randomLayer(random),
      matrix: randomMatrix(random),
    });
  }
  return cases;
}

/** The case as a failure message shows it: point types, closure, and values, without ids. */
function described({ name, state, matrix }: LayerCase) {
  return {
    name,
    matrix,
    contours: state.structure.contours.map(({ closed, points }) => ({
      closed,
      types: points.map((point) => point.pointType),
    })),
    values: state.values,
  };
}

describe("layer bounds match shift-font's for a transformed layer", () => {
  it.each(layerCases())("bounds points, anchors, and components for $name", (testCase) => {
    const expected = transformLayer(testCase.state, testCase.matrix);
    const layer = LayerBuffers.fromState({
      ...testCase.state,
      values: Float64Array.from(expected.values),
    });

    expectBoundsClose(layer.bounds, expected.bounds, described(testCase));
  });
});
