import { describe, expectTypeOf, it } from "vitest";
import type { EditorTestSurface } from "./surface";

type Primitive = string | number | boolean | bigint | symbol | null | undefined | void;

/**
 * Whether `T` is plain data: primitives, arrays of plain data, and objects
 * whose every member is plain. Functions, and so classes with methods, are not.
 */
type IsPlain<T> = T extends Primitive
  ? true
  : T extends (...args: never[]) => unknown
    ? false
    : T extends readonly (infer E)[]
      ? IsPlain<E>
      : T extends object
        ? false extends { [K in keyof T]-?: IsPlain<T[K]> }[keyof T]
          ? false
          : true
        : false;

/** The surface methods that may hand a test something other than plain data. */
type Exempt = "asEditor" | "reopen";
type Checked = Exclude<keyof EditorTestSurface, Exempt>;
type Leaks = {
  [K in Checked]: EditorTestSurface[K] extends (...args: never[]) => infer R
    ? IsPlain<Awaited<R>> extends true
      ? never
      : K
    : K;
}[Checked];

describe("EditorTestSurface", () => {
  it("hands tests only plain data", () => {
    // A method named here returns a model object, class or signal; return plain data instead.
    expectTypeOf<Leaks>().toBeNever();
  });
});
