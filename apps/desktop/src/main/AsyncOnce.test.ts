import { describe, expect, it } from "vitest";
import { AsyncOnce } from "./AsyncOnce";

describe("AsyncOnce retained work", () => {
  it("shares the exact promise while work is pending", async () => {
    const once = new AsyncOnce<number>();
    let complete!: (result: number) => void;
    const work = new Promise<number>((resolve) => {
      complete = resolve;
    });

    const first = once.run(() => work);
    const second = once.run(() => 2);
    complete(1);

    expect(second).toBe(first);
    await expect(Promise.all([first, second])).resolves.toEqual([1, 1]);
  });

  it("retains a fulfilled result until reset", async () => {
    const once = new AsyncOnce<number>();
    const first = once.run(() => 1);
    await first;

    const second = once.run(() => 2);

    expect(second).toBe(first);
    await expect(second).resolves.toBe(1);
  });

  it("turns a synchronous throw into a retained rejection", async () => {
    const once = new AsyncOnce<number>();
    const first = once.run(() => {
      throw new Error("failed");
    });
    const second = once.run(() => 2);

    expect(second).toBe(first);
    await expect(second).rejects.toThrow("failed");
  });

  it("retains an asynchronous rejection until reset", async () => {
    const once = new AsyncOnce<number>();
    const first = once.run(async () => Promise.reject(new Error("failed")));
    await expect(first).rejects.toThrow("failed");

    const second = once.run(() => 2);

    expect(second).toBe(first);
    await expect(second).rejects.toThrow("failed");
  });

  it("starts fresh work after reset", async () => {
    const once = new AsyncOnce<number>();
    const first = once.run(() => 1);
    once.reset();

    const second = once.run(() => 2);

    expect(second).not.toBe(first);
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
  });
});
