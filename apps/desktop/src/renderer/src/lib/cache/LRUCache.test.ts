import { describe, expect, it } from "vitest";
import { LRUCache } from "./LRUCache";

describe("LRUCache", () => {
  it("returns undefined for missing key", () => {
    const cache = new LRUCache<string, number>({ max: 2 });
    expect(cache.get("a")).toBeUndefined();
  });

  it("returns value after set", () => {
    const cache = new LRUCache<string, number>({ max: 2 });
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
  });

  it("evicts oldest when at capacity", () => {
    const cache = new LRUCache<string, number>({ max: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("treats get as most recently used", () => {
    const cache = new LRUCache<string, number>({ max: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("calls onEvict when evicting", () => {
    const evicted: [string, number][] = [];
    const cache = new LRUCache<string, number>({
      max: 2,
      onEvict: (k, v) => evicted.push([k, v]),
    });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(evicted).toEqual([["a", 1]]);
  });

  it("has() does not update order", () => {
    const cache = new LRUCache<string, number>({ max: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.has("a");
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
  });

  it("clear removes all entries", () => {
    const cache = new LRUCache<string, number>({ max: 2 });
    cache.set("a", 1);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
