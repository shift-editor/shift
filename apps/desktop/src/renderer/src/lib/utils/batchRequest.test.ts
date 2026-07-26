import { describe, expect, it } from "vitest";
import { createBatchRequest } from "./batchRequest";

describe("keyed batch requests", () => {
  it("combines same-turn requests and deduplicates keys", async () => {
    let loadCount = 0;
    let loadedKeys: readonly string[] = [];
    const request = createBatchRequest(async (keys) => {
      loadCount += 1;
      loadedKeys = keys;
    });

    await Promise.all([request(["a", "b"]), request(["b", "c"])]);

    expect(loadCount).toBe(1);
    expect(loadedKeys).toEqual(["a", "b", "c"]);
  });

  it("shares work for a key that is already in flight", async () => {
    let loadCount = 0;
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = createBatchRequest(async () => {
      loadCount += 1;
      await blocked;
    });

    const first = request(["a"]);
    await Promise.resolve();
    const second = request(["a"]);
    release();
    await Promise.all([first, second]);

    expect(loadCount).toBe(1);
  });

  it("forgets settled work so a key can be requested again", async () => {
    let loadCount = 0;
    const request = createBatchRequest(async () => {
      loadCount += 1;
    });

    await request(["a"]);
    await request(["a"]);

    expect(loadCount).toBe(2);
  });

  it("forgets failed work so a key can be retried", async () => {
    let loadCount = 0;
    const request = createBatchRequest(async () => {
      loadCount += 1;
      if (loadCount === 1) throw new Error("unavailable");
    });

    await expect(request(["a"])).rejects.toThrow("unavailable");
    await expect(request(["a"])).resolves.toBeUndefined();
    expect(loadCount).toBe(2);
  });
});
