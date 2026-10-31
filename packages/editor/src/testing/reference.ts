/**
 * Inputs and comparisons for tests that check a rule the editor still runs in
 * TypeScript (the inverse axis mapping) against shift-font through
 * `@shift/wasm/reference`.
 *
 * Each test generates its inputs here, runs the TypeScript and the Rust on
 * the same one, and compares with {@link expectNumbersClose}, which names the
 * input when they differ.
 */
import { assert } from "vitest";

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
