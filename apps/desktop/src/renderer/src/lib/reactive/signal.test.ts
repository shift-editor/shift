import { describe, it, expect } from "vitest";
import { signal, computed, effect, batch, untracked, isTracking } from "./signal";

describe("signal", () => {
  it("should store and return a value", () => {
    const s = signal(42);
    expect(s.value).toBe(42);
  });

  it("should update value with set()", () => {
    const s = signal(1);
    s.set(2);
    expect(s.value).toBe(2);
  });

  it("should update value with assignment", () => {
    const s = signal(1);
    s.value = 2;
    expect(s.value).toBe(2);
  });

  it("should update value with update()", () => {
    const s = signal(5);
    s.update((v) => v * 2);
    expect(s.value).toBe(10);
  });

  it("should return value without tracking via peek()", () => {
    const s = signal(10);
    const c = computed(() => s.peek());
    expect(c.value).toBe(10);

    s.value = 20;
    // Computed should NOT re-run since we used peek()
    expect(c.peek()).toBe(10);
  });

  it("should not notify if value is the same (Object.is)", () => {
    const s = signal(1);
    let fires = 0;

    effect(() => {
      s.value;
      fires++;
    });

    expect(fires).toBe(1);

    s.value = 1; // Same value
    expect(fires).toBe(1);

    s.value = 2; // Different value
    expect(fires).toBe(2);
  });

  it("should handle NaN correctly", () => {
    const s = signal(NaN);
    let fires = 0;

    effect(() => {
      s.value;
      fires++;
    });

    expect(fires).toBe(1);

    s.value = NaN; // NaN === NaN via Object.is
    expect(fires).toBe(1);
  });
});

describe("computed", () => {
  it("should derive value from signals", () => {
    const a = signal(2);
    const b = signal(3);
    const sum = computed(() => a.value + b.value);

    expect(sum.value).toBe(5);
  });

  it("should auto-update when dependencies change", () => {
    const a = signal(1);
    const doubled = computed(() => a.value * 2);

    expect(doubled.value).toBe(2);

    a.value = 5;
    expect(doubled.value).toBe(10);
  });

  it("should be lazy (only compute when accessed)", () => {
    let computes = 0;
    const c = computed(() => {
      computes++;
      return 42;
    });

    expect(computes).toBe(0);

    c.value;
    expect(computes).toBe(1);

    // Accessing again should not recompute (not dirty)
    c.value;
    expect(computes).toBe(1);
  });

  it("should chain computed values", () => {
    const a = signal(1);
    const b = computed(() => a.value * 2);
    const c = computed(() => b.value + 10);

    expect(c.value).toBe(12);

    a.value = 5;
    expect(c.value).toBe(20);
  });

  it("should support peek() without dependency tracking", () => {
    const a = signal(1);
    const c = computed(() => a.peek() * 2);

    expect(c.value).toBe(2);

    a.value = 5;
    // Should still be 2 since we used peek()
    expect(c.peek()).toBe(2);
  });

  it("should clean up old dependencies on recompute", () => {
    const condition = signal(true);
    const a = signal(1);
    const b = signal(2);

    let computes = 0;
    const c = computed(() => {
      computes++;
      return condition.value ? a.value : b.value;
    });

    c.value; // Initial compute, depends on condition + a
    expect(computes).toBe(1);

    a.value = 10; // Should trigger recompute
    c.value;
    expect(computes).toBe(2);

    b.value = 20; // Should NOT trigger recompute (not a dependency)
    c.value;
    expect(computes).toBe(2);

    // Switch condition
    condition.value = false;
    c.value;
    expect(computes).toBe(3);

    // Now a should NOT trigger, but b should
    a.value = 100;
    c.value;
    expect(computes).toBe(3);

    b.value = 200;
    c.value;
    expect(computes).toBe(4);
  });

  it("should support invalidate()", () => {
    const c = computed(() => Math.random());

    const v1 = c.value;
    const v2 = c.value;
    expect(v1).toBe(v2); // Cached

    c.invalidate();
    const v3 = c.value;
    expect(v3).not.toBe(v1); // Recomputed
  });

  describe("dispose", () => {
    it("severs dependency edges so source signals stop notifying", () => {
      const s = signal(1);
      const c = computed(() => s.value * 2);

      expect(c.value).toBe(2);

      let runs = 0;
      const e = effect(() => {
        c.value;
        runs++;
      });
      expect(runs).toBe(1);

      c.dispose();

      s.set(5);
      // c is disposed; the effect's edge through c was torn down on dispose
      // so the effect does not re-run, and c.value returns the cached value.
      expect(c.value).toBe(2);
      expect(runs).toBe(1);

      e.dispose();
    });

    it("is idempotent", () => {
      const s = signal(1);
      const c = computed(() => s.value);
      c.dispose();
      expect(() => c.dispose()).not.toThrow();
    });

    it("a direct edge keeps a consumer reactive after an intermediate is disposed", () => {
      // This is the invariant `GlyphView.#svgPath` relies on. A composite's
      // svgPath subscribes to $variationLocation through a base GlyphView's
      // #values. If the LRU evicts the base and disposes its computed, the
      // indirect chain is severed. To survive, the consumer must hold a
      // direct edge to the source.
      const source = signal(0);
      const intermediate = computed(() => source.value * 2);

      let lastSeen = -1;
      const consumer = effect(() => {
        lastSeen = source.value; // direct edge — survives intermediate dispose
        intermediate.value; // indirect edge via the disposable intermediate
      });

      expect(lastSeen).toBe(0);

      source.set(5);
      expect(lastSeen).toBe(5);

      intermediate.dispose();

      // Without the direct edge the consumer would freeze here. With it,
      // the source still reaches the consumer.
      source.set(10);
      expect(lastSeen).toBe(10);

      consumer.dispose();
    });
  });
});

describe("effect", () => {
  it("should run immediately", () => {
    let fires = 0;
    effect(() => {
      fires++;
    });
    expect(fires).toBe(1);
  });

  it("should re-run when dependencies change", () => {
    const s = signal(1);
    let fires = 0;

    effect(() => {
      s.value;
      fires++;
    });

    expect(fires).toBe(1);

    s.value = 2;
    expect(fires).toBe(2);

    s.value = 3;
    expect(fires).toBe(3);
  });

  it("should stop running after dispose()", () => {
    const s = signal(1);
    let fires = 0;

    const fx = effect(() => {
      s.value;
      fires++;
    });

    expect(fires).toBe(1);

    fx.dispose();

    s.value = 2;
    expect(fires).toBe(1); // No additional calls
  });

  it("should run cleanup function before re-execution", () => {
    const s = signal(1);
    let cleaned = 0;
    let executed = 0;

    effect(() => {
      s.value; // Subscribe to signal
      executed++;
      return () => {
        cleaned++;
      };
    });

    expect(executed).toBe(1);
    expect(cleaned).toBe(0); // No cleanup on first run

    s.value = 2;
    expect(executed).toBe(2);
    expect(cleaned).toBe(1); // Cleanup called before re-execution

    s.value = 3;
    expect(executed).toBe(3);
    expect(cleaned).toBe(2);
  });

  it("should run cleanup on dispose", () => {
    let cleaned = 0;
    const fx = effect(() => () => {
      cleaned++;
    });

    expect(cleaned).toBe(0);

    fx.dispose();
    expect(cleaned).toBe(1);
  });

  it("should update dependencies on re-run", () => {
    const condition = signal(true);
    const a = signal(1);
    const b = signal(2);
    let fires = 0;

    effect(() => {
      if (condition.value) {
        a.value;
      } else {
        b.value;
      }
      fires++;
    });

    expect(fires).toBe(1);

    // a is a dependency
    a.value = 10;
    expect(fires).toBe(2);

    // b is NOT a dependency yet
    b.value = 20;
    expect(fires).toBe(2);

    // Switch condition
    condition.value = false;
    expect(fires).toBe(3);

    // Now b IS a dependency, a is NOT
    b.value = 30;
    expect(fires).toBe(4);

    a.value = 100;
    expect(fires).toBe(4);
  });

  it("should react to computed dependencies", () => {
    const s = signal(2);
    const doubled = computed(() => s.value * 2);
    let fires = 0;

    effect(() => {
      doubled.value;
      fires++;
    });

    expect(fires).toBe(1);

    s.value = 3;
    expect(fires).toBe(2);
  });
});

describe("batch", () => {
  it("should defer effect execution until batch completes", () => {
    const a = signal(1);
    const b = signal(2);
    let fires = 0;

    effect(() => {
      a.value;
      b.value;
      fires++;
    });

    expect(fires).toBe(1);

    batch(() => {
      a.value = 10;
      b.value = 20;
    });

    // Effect should only run once, not twice
    expect(fires).toBe(2);
  });

  it("should return the value from the batch function", () => {
    const result = batch(() => 42);
    expect(result).toBe(42);
  });

  it("should handle nested batches", () => {
    const s = signal(0);
    let fires = 0;

    effect(() => {
      s.value;
      fires++;
    });

    expect(fires).toBe(1);

    batch(() => {
      s.value = 1;
      batch(() => {
        s.value = 2;
        s.value = 3;
      });
      s.value = 4;
    });

    // Should only run once after all batches complete
    expect(fires).toBe(2);
    expect(s.value).toBe(4);
  });

  it("should update computed immediately within batch", () => {
    const a = signal(1);
    const doubled = computed(() => a.value * 2);

    let capturedValue: number | undefined;

    batch(() => {
      a.value = 5;
      capturedValue = doubled.value;
    });

    // Computed should have the new value within the batch
    expect(capturedValue).toBe(10);
  });
});

describe("untracked", () => {
  it("should read signals without creating dependencies", () => {
    const a = signal(1);
    const b = signal(2);
    const calls: Array<[number, number]> = [];

    effect(() => {
      const aVal = a.value; // Tracked
      const bVal = untracked(() => b.value); // NOT tracked
      calls.push([aVal, bVal]);
    });

    expect(calls).toEqual([[1, 2]]);

    // Changing a should trigger effect
    a.value = 10;
    expect(calls).toEqual([
      [1, 2],
      [10, 2],
    ]);

    // Changing b should NOT trigger effect
    b.value = 20;
    expect(calls).toEqual([
      [1, 2],
      [10, 2],
    ]);
  });

  it("should return the value from the function", () => {
    const s = signal(42);
    const result = untracked(() => s.value * 2);
    expect(result).toBe(84);
  });
});

describe("isTracking", () => {
  it("should return false outside reactive context", () => {
    expect(isTracking()).toBe(false);
  });

  it("should return true inside computed", () => {
    let wasTracking = false;
    const c = computed(() => {
      wasTracking = isTracking();
      return 1;
    });
    c.value;
    expect(wasTracking).toBe(true);
  });

  it("should return true inside effect", () => {
    let wasTracking = false;
    effect(() => {
      wasTracking = isTracking();
    });
    expect(wasTracking).toBe(true);
  });

  it("should return false inside untracked", () => {
    let wasTracking = true;
    effect(() => {
      untracked(() => {
        wasTracking = isTracking();
      });
    });
    expect(wasTracking).toBe(false);
  });
});

describe("edge cases", () => {
  it("should handle circular computed (diamond problem)", () => {
    const a = signal(1);
    const b = computed(() => a.value + 1);
    const c = computed(() => a.value + 2);
    const d = computed(() => b.value + c.value);

    expect(d.value).toBe(5); // (1+1) + (1+2)

    a.value = 10;
    expect(d.value).toBe(23); // (10+1) + (10+2)
  });

  it("should handle object values", () => {
    const obj = signal({ count: 0 });
    let fires = 0;

    effect(() => {
      obj.value.count;
      fires++;
    });

    expect(fires).toBe(1);

    // Mutating the object doesn't trigger (same reference)
    obj.value.count = 1;
    expect(fires).toBe(1);

    // Replacing the object triggers
    obj.value = { count: 2 };
    expect(fires).toBe(2);
  });

  it("should handle multiple effects on same signal", () => {
    const s = signal(0);
    let fires1 = 0;
    let fires2 = 0;

    effect(() => {
      s.value;
      fires1++;
    });
    effect(() => {
      s.value;
      fires2++;
    });

    expect(fires1).toBe(1);
    expect(fires2).toBe(1);

    s.value = 1;
    expect(fires1).toBe(2);
    expect(fires2).toBe(2);
  });

  it("should handle effect disposal during another effect execution", () => {
    const s = signal(0);
    let fires = 0;

    let fx2: ReturnType<typeof effect> | null = null;

    const fx1 = effect(() => {
      s.value;
      if (fx2) {
        fx2.dispose();
      }
    });

    fx2 = effect(() => {
      s.value;
      fires++;
    });

    expect(fires).toBe(1);

    // This should dispose fx2 via fx1
    s.value = 1;

    // fx2 should not run again after being disposed
    s.value = 2;
    expect(fires).toBe(1);

    fx1.dispose();
  });
});
