import { describe, it, expect, vi } from 'vitest';
import { signal, computed, effect, batch, untracked, isTracking } from './signal';

describe('signal', () => {
  it('should store and return a value', () => {
    const s = signal(42);
    expect(s.value).toBe(42);
  });

  it('should update value with set()', () => {
    const s = signal(1);
    s.set(2);
    expect(s.value).toBe(2);
  });

  it('should update value with assignment', () => {
    const s = signal(1);
    s.value = 2;
    expect(s.value).toBe(2);
  });

  it('should update value with update()', () => {
    const s = signal(5);
    s.update((v) => v * 2);
    expect(s.value).toBe(10);
  });

  it('should return value without tracking via peek()', () => {
    const s = signal(10);
    const fn = vi.fn(() => s.peek());

    const c = computed(fn);
    expect(c.value).toBe(10);

    s.value = 20;
    // Computed should NOT re-run since we used peek()
    expect(c.peek()).toBe(10);
  });

  it('should not notify if value is the same (Object.is)', () => {
    const s = signal(1);
    const fn = vi.fn();

    effect(() => {
      s.value;
      fn();
    });

    expect(fn).toHaveBeenCalledTimes(1);

    s.value = 1; // Same value
    expect(fn).toHaveBeenCalledTimes(1);

    s.value = 2; // Different value
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should handle NaN correctly', () => {
    const s = signal(NaN);
    const fn = vi.fn();

    effect(() => {
      s.value;
      fn();
    });

    expect(fn).toHaveBeenCalledTimes(1);

    s.value = NaN; // NaN === NaN via Object.is
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('computed', () => {
  it('should derive value from signals', () => {
    const a = signal(2);
    const b = signal(3);
    const sum = computed(() => a.value + b.value);

    expect(sum.value).toBe(5);
  });

  it('should auto-update when dependencies change', () => {
    const a = signal(1);
    const doubled = computed(() => a.value * 2);

    expect(doubled.value).toBe(2);

    a.value = 5;
    expect(doubled.value).toBe(10);
  });

  it('should be lazy (only compute when accessed)', () => {
    const fn = vi.fn(() => 42);
    const c = computed(fn);

    expect(fn).not.toHaveBeenCalled();

    c.value;
    expect(fn).toHaveBeenCalledTimes(1);

    // Accessing again should not recompute (not dirty)
    c.value;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should chain computed values', () => {
    const a = signal(1);
    const b = computed(() => a.value * 2);
    const c = computed(() => b.value + 10);

    expect(c.value).toBe(12);

    a.value = 5;
    expect(c.value).toBe(20);
  });

  it('should support peek() without dependency tracking', () => {
    const a = signal(1);
    const c = computed(() => a.peek() * 2);

    expect(c.value).toBe(2);

    a.value = 5;
    // Should still be 2 since we used peek()
    expect(c.peek()).toBe(2);
  });

  it('should clean up old dependencies on recompute', () => {
    const condition = signal(true);
    const a = signal(1);
    const b = signal(2);

    const fn = vi.fn();
    const c = computed(() => {
      fn();
      return condition.value ? a.value : b.value;
    });

    c.value; // Initial compute, depends on condition + a
    expect(fn).toHaveBeenCalledTimes(1);

    a.value = 10; // Should trigger recompute
    c.value;
    expect(fn).toHaveBeenCalledTimes(2);

    b.value = 20; // Should NOT trigger recompute (not a dependency)
    c.value;
    expect(fn).toHaveBeenCalledTimes(2);

    // Switch condition
    condition.value = false;
    c.value;
    expect(fn).toHaveBeenCalledTimes(3);

    // Now a should NOT trigger, but b should
    a.value = 100;
    c.value;
    expect(fn).toHaveBeenCalledTimes(3);

    b.value = 200;
    c.value;
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('should support invalidate()', () => {
    const fn = vi.fn(() => Math.random());
    const c = computed(fn);

    const v1 = c.value;
    const v2 = c.value;
    expect(v1).toBe(v2); // Cached

    c.invalidate();
    const v3 = c.value;
    expect(v3).not.toBe(v1); // Recomputed
  });
});

describe('effect', () => {
  it('should run immediately', () => {
    const fn = vi.fn();
    effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should re-run when dependencies change', () => {
    const s = signal(1);
    const fn = vi.fn();

    effect(() => {
      s.value;
      fn();
    });

    expect(fn).toHaveBeenCalledTimes(1);

    s.value = 2;
    expect(fn).toHaveBeenCalledTimes(2);

    s.value = 3;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should stop running after dispose()', () => {
    const s = signal(1);
    const fn = vi.fn();

    const fx = effect(() => {
      s.value;
      fn();
    });

    expect(fn).toHaveBeenCalledTimes(1);

    fx.dispose();

    s.value = 2;
    expect(fn).toHaveBeenCalledTimes(1); // No additional calls
  });

  it('should run cleanup function before re-execution', () => {
    const s = signal(1);
    const cleanup = vi.fn();
    const executed = vi.fn();

    effect(() => {
      s.value; // Subscribe to signal
      executed();
      return cleanup;
    });

    expect(executed).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled(); // No cleanup on first run

    s.value = 2;
    expect(executed).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledTimes(1); // Cleanup called before re-execution

    s.value = 3;
    expect(executed).toHaveBeenCalledTimes(3);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('should run cleanup on dispose', () => {
    const cleanup = vi.fn();
    const fx = effect(() => cleanup);

    expect(cleanup).not.toHaveBeenCalled();

    fx.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('should update dependencies on re-run', () => {
    const condition = signal(true);
    const a = signal(1);
    const b = signal(2);
    const fn = vi.fn();

    effect(() => {
      if (condition.value) {
        a.value;
      } else {
        b.value;
      }
      fn();
    });

    expect(fn).toHaveBeenCalledTimes(1);

    // a is a dependency
    a.value = 10;
    expect(fn).toHaveBeenCalledTimes(2);

    // b is NOT a dependency yet
    b.value = 20;
    expect(fn).toHaveBeenCalledTimes(2);

    // Switch condition
    condition.value = false;
    expect(fn).toHaveBeenCalledTimes(3);

    // Now b IS a dependency, a is NOT
    b.value = 30;
    expect(fn).toHaveBeenCalledTimes(4);

    a.value = 100;
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('should react to computed dependencies', () => {
    const s = signal(2);
    const doubled = computed(() => s.value * 2);
    const fn = vi.fn();

    effect(() => {
      doubled.value;
      fn();
    });

    expect(fn).toHaveBeenCalledTimes(1);

    s.value = 3;
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('batch', () => {
  it('should defer effect execution until batch completes', () => {
    const a = signal(1);
    const b = signal(2);
    const fn = vi.fn();

    effect(() => {
      a.value;
      b.value;
      fn();
    });

    expect(fn).toHaveBeenCalledTimes(1);

    batch(() => {
      a.value = 10;
      b.value = 20;
    });

    // Effect should only run once, not twice
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should return the value from the batch function', () => {
    const result = batch(() => {
      return 42;
    });
    expect(result).toBe(42);
  });

  it('should handle nested batches', () => {
    const s = signal(0);
    const fn = vi.fn();

    effect(() => {
      s.value;
      fn();
    });

    expect(fn).toHaveBeenCalledTimes(1);

    batch(() => {
      s.value = 1;
      batch(() => {
        s.value = 2;
        s.value = 3;
      });
      s.value = 4;
    });

    // Should only run once after all batches complete
    expect(fn).toHaveBeenCalledTimes(2);
    expect(s.value).toBe(4);
  });

  it('should update computed immediately within batch', () => {
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

describe('untracked', () => {
  it('should read signals without creating dependencies', () => {
    const a = signal(1);
    const b = signal(2);
    const fn = vi.fn();

    effect(() => {
      const aVal = a.value; // Tracked
      const bVal = untracked(() => b.value); // NOT tracked
      fn(aVal, bVal);
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1, 2);

    // Changing a should trigger effect
    a.value = 10;
    expect(fn).toHaveBeenCalledTimes(2);

    // Changing b should NOT trigger effect
    b.value = 20;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should return the value from the function', () => {
    const s = signal(42);
    const result = untracked(() => s.value * 2);
    expect(result).toBe(84);
  });
});

describe('isTracking', () => {
  it('should return false outside reactive context', () => {
    expect(isTracking()).toBe(false);
  });

  it('should return true inside computed', () => {
    let wasTracking = false;
    const c = computed(() => {
      wasTracking = isTracking();
      return 1;
    });
    c.value;
    expect(wasTracking).toBe(true);
  });

  it('should return true inside effect', () => {
    let wasTracking = false;
    effect(() => {
      wasTracking = isTracking();
    });
    expect(wasTracking).toBe(true);
  });

  it('should return false inside untracked', () => {
    let wasTracking = true;
    effect(() => {
      untracked(() => {
        wasTracking = isTracking();
      });
    });
    expect(wasTracking).toBe(false);
  });
});

describe('edge cases', () => {
  it('should handle circular computed (diamond problem)', () => {
    const a = signal(1);
    const b = computed(() => a.value + 1);
    const c = computed(() => a.value + 2);
    const d = computed(() => b.value + c.value);

    expect(d.value).toBe(5); // (1+1) + (1+2)

    a.value = 10;
    expect(d.value).toBe(23); // (10+1) + (10+2)
  });

  it('should handle object values', () => {
    const obj = signal({ count: 0 });
    const fn = vi.fn();

    effect(() => {
      obj.value.count;
      fn();
    });

    expect(fn).toHaveBeenCalledTimes(1);

    // Mutating the object doesn't trigger (same reference)
    obj.value.count = 1;
    expect(fn).toHaveBeenCalledTimes(1);

    // Replacing the object triggers
    obj.value = { count: 2 };
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should handle multiple effects on same signal', () => {
    const s = signal(0);
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    effect(() => {
      s.value;
      fn1();
    });
    effect(() => {
      s.value;
      fn2();
    });

    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);

    s.value = 1;
    expect(fn1).toHaveBeenCalledTimes(2);
    expect(fn2).toHaveBeenCalledTimes(2);
  });

  it('should handle effect disposal during another effect execution', () => {
    const s = signal(0);
    const fn = vi.fn();

    let fx2: ReturnType<typeof effect> | null = null;

    const fx1 = effect(() => {
      s.value;
      if (fx2) {
        fx2.dispose();
      }
    });

    fx2 = effect(() => {
      s.value;
      fn();
    });

    expect(fn).toHaveBeenCalledTimes(1);

    // This should dispose fx2 via fx1
    s.value = 1;

    // fx2 should not run again after being disposed
    s.value = 2;
    expect(fn).toHaveBeenCalledTimes(1);

    fx1.dispose();
  });
});
