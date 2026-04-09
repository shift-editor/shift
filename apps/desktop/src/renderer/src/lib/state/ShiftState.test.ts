import { describe, it, expect, beforeEach } from "vitest";
import { ShiftStateImpl, StateRegistry } from "./ShiftState";
import { effect } from "@/lib/reactive/signal";

describe("ShiftState", () => {
  it("initializes with the factory value", () => {
    const state = new ShiftStateImpl({
      id: "test",
      scope: "app",
      initial: () => 42,
      serialize: (v) => v,
      deserialize: (v) => v as number,
    });

    expect(state.value).toBe(42);
  });

  it("set updates the value", () => {
    const state = new ShiftStateImpl({
      id: "test",
      scope: "app",
      initial: () => "hello",
      serialize: (v) => v,
      deserialize: (v) => v as string,
    });

    state.set("world");

    expect(state.value).toBe("world");
  });

  it("reset returns to initial value", () => {
    const state = new ShiftStateImpl({
      id: "test",
      scope: "app",
      initial: () => 0,
      serialize: (v) => v,
      deserialize: (v) => v as number,
    });

    state.set(99);
    state.reset();

    expect(state.value).toBe(0);
  });

  it("is reactive — triggers effects on set", () => {
    const state = new ShiftStateImpl({
      id: "test",
      scope: "app",
      initial: () => "a",
      serialize: (v) => v,
      deserialize: (v) => v as string,
    });

    const values: string[] = [];
    const fx = effect(() => {
      values.push(state.value);
    });

    state.set("b");
    state.set("c");

    expect(values).toEqual(["a", "b", "c"]);
    fx.dispose();
  });

  it("capture serializes the current value", () => {
    const state = new ShiftStateImpl({
      id: "test",
      scope: "document",
      initial: () => ({ count: 0 }),
      serialize: (v) => ({ ...v, serialized: true }),
      deserialize: (v) => v as { count: number },
    });

    state.set({ count: 5 });
    const captured = state.capture() as { count: number; serialized: boolean };

    expect(captured.count).toBe(5);
    expect(captured.serialized).toBe(true);
  });

  it("hydrate deserializes and sets the value", () => {
    const state = new ShiftStateImpl({
      id: "test",
      scope: "document",
      initial: () => ({ count: 0 }),
      serialize: (v) => v,
      deserialize: (v) => v as { count: number },
    });

    state.hydrate({ count: 42 });

    expect(state.value).toEqual({ count: 42 });
  });

  it("peek reads without tracking", () => {
    const state = new ShiftStateImpl({
      id: "test",
      scope: "app",
      initial: () => 1,
      serialize: (v) => v,
      deserialize: (v) => v as number,
    });

    let effectCount = 0;
    const fx = effect(() => {
      state.peek();
      effectCount++;
    });

    state.set(2);
    state.set(3);

    expect(effectCount).toBe(1);
    expect(state.peek()).toBe(3);
    fx.dispose();
  });
});

describe("StateRegistry", () => {
  let registry: StateRegistry;

  beforeEach(() => {
    registry = new StateRegistry();
  });

  it("registers and retrieves state by id", () => {
    const state = registry.register({
      id: "foo",
      scope: "app",
      initial: () => 0,
      serialize: (v) => v,
      deserialize: (v) => v as number,
    });

    expect(state.id).toBe("foo");
    expect(registry.get("foo")).toBeDefined();
  });

  it("throws on duplicate id", () => {
    registry.register({
      id: "foo",
      scope: "app",
      initial: () => 0,
      serialize: (v) => v,
      deserialize: (v) => v as number,
    });

    expect(() =>
      registry.register({
        id: "foo",
        scope: "app",
        initial: () => 0,
        serialize: (v) => v,
        deserialize: (v) => v as number,
      }),
    ).toThrow('State "foo" already registered');
  });

  it("filters by scope", () => {
    registry.register({
      id: "app-state",
      scope: "app",
      initial: () => null,
      serialize: (v) => v,
      deserialize: (v) => v,
    });
    registry.register({
      id: "doc-state",
      scope: "document",
      initial: () => null,
      serialize: (v) => v,
      deserialize: (v) => v,
    });

    expect(registry.getByScope("app")).toHaveLength(1);
    expect(registry.getByScope("document")).toHaveLength(1);
    expect(registry.getByScope("app")[0].id).toBe("app-state");
  });

  it("all returns every registered state", () => {
    registry.register({
      id: "a",
      scope: "app",
      initial: () => 0,
      serialize: (v) => v,
      deserialize: (v) => v as number,
    });
    registry.register({
      id: "b",
      scope: "document",
      initial: () => 0,
      serialize: (v) => v,
      deserialize: (v) => v as number,
    });

    expect(registry.all()).toHaveLength(2);
  });

  it("clear removes all states", () => {
    registry.register({
      id: "a",
      scope: "app",
      initial: () => 0,
      serialize: (v) => v,
      deserialize: (v) => v as number,
    });
    registry.clear();

    expect(registry.all()).toHaveLength(0);
  });
});
