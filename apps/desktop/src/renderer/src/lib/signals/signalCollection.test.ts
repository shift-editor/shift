import { Session } from "node:inspector/promises";
import { setImmediate } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computed, effect, signal, signalDebug, type Signal } from "./signal";

const session = new Session();

beforeEach(() => session.connect());
afterEach(() => session.disconnect());

describe("signal diagnostics do not own reactive objects", () => {
  it.each([
    { kind: "signal", create: () => signal(1, { name: "collectible.signal" }) },
    { kind: "computed", create: () => computed(() => 1, { name: "collectible.computed" }) },
    { kind: "effect", create: () => effect(() => {}, { name: "collectible.effect" }) },
  ])("allows an unowned $kind to be collected", async ({ kind, create }) => {
    const name = `collectible.${kind}`;
    const reference = new WeakRef(create());
    expect(signalDebug.find(name)).toHaveLength(1);

    // WeakRef creation/deref keeps the target alive until the current job ends.
    await setImmediate();
    await session.post("HeapProfiler.collectGarbage");

    expect(reference.deref()).toBeUndefined();
    expect(signalDebug.find(name)).toEqual([]);
    expect(signalDebug.dumpByName(name)).toBe(`No signal debug nodes matched ${name}.`);
    expect(signalDebug.list().some((node) => node.name === name)).toBe(false);
    expect(signalDebug.dump(undefined, { depth: 0 })).not.toContain(name);
  });

  it("keeps externally owned disposed nodes inspectable", async () => {
    const derived = computed(() => 42, { name: "owned.computed" });
    const observer = effect(
      () => {
        derived.value;
      },
      { name: "owned.effect" },
    );
    observer.dispose();
    derived.dispose();

    await setImmediate();
    await session.post("HeapProfiler.collectGarbage");

    const snapshots = [derived.debug(), observer.debug()];
    expect(signalDebug.find(/^owned\./)).toEqual(snapshots);
    expect(signalDebug.list().filter((node) => node.name.startsWith("owned."))).toEqual(snapshots);
    expect(signalDebug.dump(undefined, { depth: 0 })).toContain("computed(owned.computed)");
    expect(signalDebug.dumpByName(/^owned\./)).toContain("effect(owned.effect)");
    expect(derived.value).toBe(42);
  });

  it("keeps a subscribed effect reactive while its source is owned", async () => {
    const sourceCell = signal(1);
    let observed = 0;
    effect(() => {
      observed = sourceCell.value;
    });

    await setImmediate();
    await session.post("HeapProfiler.collectGarbage");
    sourceCell.set(2);

    expect(observed).toBe(2);
  });

  it.each([
    {
      kind: "computed",
      create: (sourceCell: Signal<number>) => {
        const derived = computed(() => sourceCell.value, { name: "disposed.computed" });
        derived.value;
        return derived;
      },
    },
    {
      kind: "effect",
      create: (sourceCell: Signal<number>) =>
        effect(
          () => {
            sourceCell.value;
          },
          { name: "disposed.effect" },
        ),
    },
  ])("releases a disposed $kind while its source is still owned", async ({ create }) => {
    const sourceCell = signal(1);
    const reference = new WeakRef(create(sourceCell));
    reference.deref()!.dispose();

    await setImmediate();
    await session.post("HeapProfiler.collectGarbage");

    expect(reference.deref()).toBeUndefined();
    expect(signalDebug.find(/^disposed\./)).toEqual([]);
    expect(sourceCell.debug().subscribers).toEqual([]);
    expect(sourceCell.value).toBe(1);
  });
});
