import { describe, expect, it } from "vitest";
import { LruCache } from "./LruCache";

describe("LruCache", () => {
  it("stores and retrieves values up to capacity", () => {
    const cache = new LruCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(3);
  });

  it("evicts least-recently-used entry when capacity exceeded", () => {
    const evicted: Array<[string, number]> = [];
    const cache = new LruCache<string, number>(2, (v, k) => evicted.push([k, v]));

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
    expect(evicted).toEqual([["a", 1]]);
  });

  it("get() promotes entry to most-recently-used", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);

    cache.get("a");
    cache.set("c", 3);

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  it("set() of an existing key promotes without exceeding capacity", () => {
    const evicted: Array<[string, number]> = [];
    const cache = new LruCache<string, number>(2, (v, k) => evicted.push([k, v]));
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 99);

    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe(99);
    expect(evicted).toEqual([]);

    cache.set("c", 3);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("c")).toBe(true);
    expect(evicted).toEqual([["b", 2]]);
  });

  it("clear() runs onEvict for every entry", () => {
    const evicted: Array<[string, number]> = [];
    const cache = new LruCache<string, number>(3, (v, k) => evicted.push([k, v]));
    cache.set("a", 1);
    cache.set("b", 2);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(evicted).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("rejects capacity < 1", () => {
    expect(() => new LruCache(0)).toThrow();
  });
});
