import { describe, expect, it } from "vitest";
import { springEasing } from "./springEasing";

function progress(easing: string): number[] {
  return easing.slice("linear(".length, -1).split(", ").map(Number);
}

describe("springEasing", () => {
  it("runs from 0 to 1", () => {
    const points = progress(springEasing({ visualDuration: 0.2, bounce: 0.1 }).easing);

    expect(points[0]).toBe(0);
    expect(points.at(-1)).toBe(1);
  });

  it("never passes its target without bounce", () => {
    const points = progress(springEasing({ visualDuration: 0.2, bounce: 0 }).easing);

    expect(Math.max(...points)).toBeLessThanOrEqual(1);
  });

  it("overshoots its target with bounce", () => {
    const points = progress(springEasing({ visualDuration: 0.2, bounce: 0.15 }).easing);

    expect(Math.max(...points)).toBeGreaterThan(1);
  });

  it("runs longer for a longer visual duration", () => {
    const quick = springEasing({ visualDuration: 0.1, bounce: 0 });
    const slow = springEasing({ visualDuration: 0.3, bounce: 0 });

    expect(slow.duration).toBeGreaterThan(quick.duration);
  });
});
