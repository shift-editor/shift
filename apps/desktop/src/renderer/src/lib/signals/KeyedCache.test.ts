import { describe, expect, it } from "vitest";
import { computed, type Signal } from "./signal";
import { keyedCache } from "./KeyedCache";

interface Input {
  readonly id: string;
  readonly value: number;
}

class CachedValue {
  readonly doubled;

  constructor(readonly input: Signal<Input>) {
    this.doubled = computed(() => input.value.value * 2);
  }
}

describe("KeyedCache", () => {
  it("reuses cached values when keys are retained", () => {
    const cache = keyedCache({
      key: (input) => input.id,
      create: (input) => new CachedValue(input),
    });

    const first = cache.map([
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ]);
    const second = cache.map([
      { id: "b", value: 20 },
      { id: "a", value: 10 },
    ]);

    expect(second[0]).toBe(first[1]);
    expect(second[1]).toBe(first[0]);
    expect(second[0]?.doubled.value).toBe(40);
    expect(second[1]?.doubled.value).toBe(20);
  });

  it("updates the cached input signal instead of recreating the value", () => {
    const cache = keyedCache({
      key: (input) => input.id,
      create: (input) => new CachedValue(input),
    });

    const value = cache.get({ id: "a", value: 1 });
    const next = cache.get({ id: "a", value: 5 });

    expect(next).toBe(value);
    expect(value.input.value).toEqual({ id: "a", value: 5 });
    expect(value.doubled.value).toBe(10);
  });

  it("disposes values whose keys are removed during map", () => {
    const disposed: CachedValue[] = [];
    const cache = keyedCache({
      key: (input) => input.id,
      create: (input) => new CachedValue(input),
      dispose: (value) => disposed.push(value),
    });

    const values = cache.map([
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ]);

    cache.map([{ id: "a", value: 3 }]);

    expect(disposed).toEqual([values[1]]);
  });

  it("clears cached values", () => {
    const disposed: CachedValue[] = [];
    const cache = keyedCache({
      key: (input) => input.id,
      create: (input) => new CachedValue(input),
      dispose: (value) => disposed.push(value),
    });

    const values = cache.map([
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ]);

    cache.clear();

    expect(disposed).toEqual(values);
    expect(cache.map([{ id: "a", value: 1 }])[0]).not.toBe(values[0]);
  });
});
