/**
 * Inputs and comparisons for tests that check the editor's TypeScript geometry
 * against shift-font through `@shift/wasm/reference`.
 *
 * Each test generates its inputs here, runs the TypeScript and the Rust on
 * the same one, and compares with {@link expectNumbersClose}, which names the
 * input when they differ.
 */
import { assert } from "vitest";
import type { Bounds, DecomposedTransform, MatModel } from "@shift/geo";
import type { PointType } from "@shift/types";

/**
 * Decimal digits two results must agree to, as `toBeCloseTo` counts them.
 *
 * The TypeScript and Rust run the same float operations in nearly the same
 * order, so they agree to about 1e-12 on these magnitudes; 9 digits leaves
 * room for reordered sums without hiding a different rule.
 */
const REFERENCE_DIGITS = 9;

/** The seed every sweep starts from, so a failure reproduces exactly. */
export const REFERENCE_SEED = 0x5eed;

/** A deterministic generator of numbers in [0, 1) (mulberry32). */
export type Random = () => number;

export function seededRandom(seed: number = REFERENCE_SEED): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number in [min, max) with a fractional part. */
export function between(random: Random, min: number, max: number): number {
  return min + random() * (max - min);
}

/**
 * Signed difference between two angles in degrees, in [-180, 180).
 *
 * Compare decomposed rotations with this rather than subtracting them: 180°
 * and -180° are the same rotation, and a flip lands on either depending on
 * the sign of a zero in its matrix.
 */
function angleBetween(a: number, b: number): number {
  return ((((a - b + 180) % 360) + 360) % 360) - 180;
}

/** Formats a test input for a failure message. */
export function describeInput(input: unknown): string {
  return JSON.stringify(input, (_, value: unknown) =>
    value instanceof Float64Array ? [...value] : value,
  );
}

export interface NumberComparison {
  /** Labels for each position, used in the failure message. */
  readonly labels?: readonly string[];
  /** Positions holding angles in degrees, compared by {@link angleBetween}. */
  readonly angles?: ReadonlySet<number>;
}

/**
 * Asserts two number lists agree to {@link REFERENCE_DIGITS}, reporting every
 * mismatch together with `input`.
 */
export function expectNumbersClose(
  actual: readonly number[],
  expected: readonly number[],
  input: unknown,
  comparison: NumberComparison = {},
): void {
  const tolerance = 10 ** -REFERENCE_DIGITS / 2;
  const mismatches: string[] = [];
  if (actual.length !== expected.length) {
    mismatches.push(`length: typescript ${actual.length}, rust ${expected.length}`);
  }

  const length = Math.min(actual.length, expected.length);
  for (let index = 0; index < length; index++) {
    const ts = actual[index]!;
    const rust = expected[index]!;
    if (Object.is(ts, rust)) continue;

    const difference = comparison.angles?.has(index) ? angleBetween(ts, rust) : ts - rust;
    if (Math.abs(difference) < tolerance) continue;

    const label = comparison.labels?.[index] ?? `[${index}]`;
    mismatches.push(`${label}: typescript ${ts}, rust ${rust}`);
  }

  if (mismatches.length === 0) return;
  assert.fail(
    `TypeScript and Rust differ for input ${describeInput(input)}\n  ${mismatches.join("\n  ")}`,
  );
}

const MATRIX_KEYS = ["a", "b", "c", "d", "e", "f"] as const;
const DECOMPOSED_KEYS = [
  "translateX",
  "translateY",
  "rotation",
  "scaleX",
  "scaleY",
  "skewX",
  "skewY",
  "tCenterX",
  "tCenterY",
] as const;
const BOUNDS_LABELS = ["min.x", "min.y", "max.x", "max.y"];

export function expectMatricesClose(actual: MatModel, expected: MatModel, input: unknown): void {
  expectNumbersClose(
    MATRIX_KEYS.map((key) => actual[key]),
    MATRIX_KEYS.map((key) => expected[key]),
    input,
    { labels: MATRIX_KEYS },
  );
}

export function expectDecomposedClose(
  actual: DecomposedTransform,
  expected: DecomposedTransform,
  input: unknown,
): void {
  expectNumbersClose(
    DECOMPOSED_KEYS.map((key) => actual[key]),
    DECOMPOSED_KEYS.map((key) => expected[key]),
    input,
    { labels: DECOMPOSED_KEYS, angles: new Set([DECOMPOSED_KEYS.indexOf("rotation")]) },
  );
}

/** Asserts two boxes agree; Rust reports no box as `undefined`. */
export function expectBoundsClose(
  actual: Bounds | null,
  expected: Bounds | undefined,
  input: unknown,
): void {
  const numbers = (bounds: Bounds | null | undefined) =>
    bounds ? [bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y] : [];
  expectNumbersClose(numbers(actual), numbers(expected), input, { labels: BOUNDS_LABELS });
}

/** One authored contour point. */
export interface ReferencePoint {
  readonly x: number;
  readonly y: number;
  readonly pointType: PointType;
}

export interface ContourCase {
  readonly name: string;
  readonly closed: boolean;
  readonly points: readonly ReferencePoint[];
}

const POINT_TYPES: readonly PointType[] = ["onCurve", "offCurve", "qCurve"];

/**
 * Every on/off-curve pattern of one to four points, open and closed, then
 * curated curves and a seeded sweep.
 *
 * Segment parsing looks at most three points ahead, so four points with
 * wrapping reach every branch of the parser.
 */
export function contourCases(sweep = 300): ContourCase[] {
  const random = seededRandom();
  const coordinate = () => Math.round(between(random, -500, 500) * 4) / 4;
  const cases: ContourCase[] = [];

  for (let length = 1; length <= 4; length++) {
    for (let mask = 0; mask < 1 << length; mask++) {
      const types = Array.from(
        { length },
        (_, bit): PointType => (mask & (1 << bit) ? "onCurve" : "offCurve"),
      );
      for (const closed of [false, true]) {
        const pattern = types.map((type) => (type === "offCurve" ? "off" : "on")).join(",");
        cases.push({
          name: `${closed ? "closed" : "open"} ${pattern}`,
          closed,
          points: types.map((pointType) => ({ x: coordinate(), y: coordinate(), pointType })),
        });
      }
    }
  }

  cases.push(...curatedContours());

  for (let index = 0; index < sweep; index++) {
    const length = 2 + Math.floor(random() * 7);
    cases.push({
      name: `random contour ${index}`,
      closed: random() < 0.5,
      points: Array.from({ length }, () => ({
        x: between(random, -500, 500),
        y: between(random, -500, 500),
        pointType: POINT_TYPES[Math.floor(random() * POINT_TYPES.length)]!,
      })),
    });
  }

  return cases;
}

function contour(
  name: string,
  closed: boolean,
  points: readonly (readonly [number, number, PointType])[],
): ContourCase {
  return { name, closed, points: points.map(([x, y, pointType]) => ({ x, y, pointType })) };
}

const ON = "onCurve";
const OFF = "offCurve";
const Q = "qCurve";

/** Curves whose bounds need care: extrema, retracted handles, truncated tails, and near-degenerate derivatives. */
function curatedContours(): ContourCase[] {
  return [
    contour("quadratic with interior extrema", false, [
      [0, 0, ON],
      [50, 100, OFF],
      [100, 0, Q],
    ]),
    contour("bulging cubic", false, [
      [0, 0, ON],
      [0, 200, OFF],
      [100, 200, OFF],
      [100, 0, ON],
    ]),
    contour("s-curve cubic", false, [
      [0, 0, ON],
      [100, 200, OFF],
      [-100, -200, OFF],
      [100, 0, ON],
    ]),
    contour("cubic with retracted handles", false, [
      [10, 10, ON],
      [10, 10, OFF],
      [90, 40, OFF],
      [90, 40, ON],
    ]),
    contour("cubic collapsed to a point", false, [
      [42, 42, ON],
      [42, 42, OFF],
      [42, 42, OFF],
      [42, 42, ON],
    ]),
    contour("cubic whose x derivative is nearly linear", false, [
      [0, 0, ON],
      [30, 80, OFF],
      [60 + 1e-11, -40, OFF],
      [90, 10, ON],
    ]),
    contour("tiny cubic tail split near its end", false, [
      [99.9997, 0.0009, ON],
      [99.9998, 0.0006, OFF],
      [99.9999, 0.0003, OFF],
      [100, 0, ON],
    ]),
    contour("nearly straight quadratic", false, [
      [0, 0, ON],
      [50 + 2e-11, 50, OFF],
      [100, 100, ON],
    ]),
    contour("closed TrueType-style quadratics", true, [
      [0, 0, ON],
      [120, -40, OFF],
      [200, 60, Q],
      [240, 200, OFF],
      [60, 180, Q],
    ]),
    contour("open cubic with a dangling handle", false, [
      [0, 0, ON],
      [40, 90, OFF],
      [80, 90, OFF],
      [120, 0, ON],
      [160, -90, OFF],
    ]),
    contour("open cubic missing its end point", false, [
      [0, 0, ON],
      [100, 0, ON],
      [140, 80, OFF],
      [180, 80, OFF],
    ]),
  ];
}

export interface TransformCase {
  readonly name: string;
  readonly transform: DecomposedTransform;
}

const IDENTITY: DecomposedTransform = {
  translateX: 0,
  translateY: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  tCenterX: 0,
  tCenterY: 0,
};

/** Named component placements, including collapsed scales, then a seeded sweep. */
export function transformCases(sweep = 200): TransformCase[] {
  const named = (name: string, fields: Partial<DecomposedTransform>): TransformCase => ({
    name,
    transform: { ...IDENTITY, ...fields },
  });
  const cases = [
    named("identity", {}),
    named("translation", { translateX: 120.5, translateY: -48.25 }),
    named("rotation 90", { rotation: 90 }),
    named("rotation -135", { translateX: 10, translateY: 20, rotation: -135 }),
    named("rotation 180", { rotation: 180 }),
    named("non-uniform scale", { scaleX: 0.5, scaleY: 3 }),
    named("horizontal flip", { translateX: 500, scaleX: -1 }),
    named("double flip", { scaleX: -1, scaleY: -1 }),
    named("skew both", { skewX: 12, skewY: 8 }),
    named("rotation about center", { rotation: 45, tCenterX: 250, tCenterY: 350 }),
    named("flip about center", { translateX: 4, translateY: -6, scaleX: -1, tCenterX: 250 }),
    named("zero x scale", { translateX: 5, translateY: 5, rotation: 20, scaleX: 0, tCenterX: 10 }),
    named("zero y scale", { rotation: -70, scaleY: 0, skewX: 15 }),
    named("zero scale", { rotation: 33, scaleX: 0, scaleY: 0 }),
  ];

  const random = seededRandom(REFERENCE_SEED + 1);
  for (let index = 0; index < sweep; index++) {
    const scale = () => (random() < 0.5 ? -1 : 1) * between(random, 0.1, 3);
    cases.push(
      named(`random transform ${index}`, {
        translateX: between(random, -500, 500),
        translateY: between(random, -500, 500),
        rotation: between(random, -180, 180),
        scaleX: scale(),
        scaleY: scale(),
        skewX: between(random, -40, 40),
        skewY: between(random, -40, 40),
        tCenterX: between(random, -300, 300),
        tCenterY: between(random, -300, 300),
      }),
    );
  }

  return cases;
}

export interface MatrixCase {
  readonly name: string;
  readonly matrix: MatModel;
}

const matrix = (a: number, b: number, c: number, d: number, e: number, f: number): MatModel => ({
  a,
  b,
  c,
  d,
  e,
  f,
});

/** Raw affine matrices, singular ones included, then a seeded sweep. */
export function matrixCases(sweep = 200): MatrixCase[] {
  const cases: MatrixCase[] = [
    { name: "identity", matrix: matrix(1, 0, 0, 1, 0, 0) },
    { name: "translation", matrix: matrix(1, 0, 0, 1, -15, 42) },
    { name: "scale", matrix: matrix(3, 0, 0, 0.25, 0, 0) },
    { name: "horizontal flip", matrix: matrix(-1, 0, 0, 1, 600, 0) },
    { name: "vertical flip", matrix: matrix(1, 0, 0, -1, 0, 800) },
    { name: "shear x", matrix: matrix(1, 0, 0.4, 1, 0, 0) },
    { name: "shear y", matrix: matrix(1, 0.3, 0, 1, 0, 0) },
    { name: "reflection with rotation", matrix: matrix(0, 1, 1, 0, 3, 4) },
    { name: "zero x axis", matrix: matrix(0, 0, 0, 2, 1, 1) },
    { name: "zero y axis", matrix: matrix(1.5, -0.5, 0, 0, 0, 0) },
    { name: "collapsed to a line", matrix: matrix(1, 2, 2, 4, 0, 0) },
    { name: "zero matrix", matrix: matrix(0, 0, 0, 0, 7, -7) },
  ];

  const random = seededRandom(REFERENCE_SEED + 2);
  for (let index = 0; index < sweep; index++) {
    cases.push({
      name: `random matrix ${index}`,
      matrix: matrix(
        between(random, -3, 3),
        between(random, -3, 3),
        between(random, -3, 3),
        between(random, -3, 3),
        between(random, -500, 500),
        between(random, -500, 500),
      ),
    });
  }

  return cases;
}
