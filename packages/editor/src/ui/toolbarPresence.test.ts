import { describe, expect, it } from "vitest";
import { springEasing } from "./springEasing";
import {
  TOOL_FLOOR_OPACITY,
  TOOL_TURN_DIM,
  TOOL_TURN_OPACITY,
  toolDipKeyframes,
  toolOpacityForApproach,
} from "./toolbarPresence";

describe("tools fade as the pointer nears a slot that turns the bar", () => {
  it("stay fully visible when no slot would turn the bar", () => {
    expect(toolOpacityForApproach(null, 200)).toBe(1);
  });

  it("are fully visible at the start of the approach", () => {
    expect(toolOpacityForApproach(200, 200)).toBe(1);
    expect(toolOpacityForApproach(500, 200)).toBe(1);
  });

  it("fade continuously toward the floor", () => {
    expect(toolOpacityForApproach(100, 200)).toBeCloseTo((1 + TOOL_FLOOR_OPACITY) / 2);
  });

  it("settle at the floor, not zero, once the pointer is in range", () => {
    expect(toolOpacityForApproach(0, 200)).toBe(TOOL_FLOOR_OPACITY);
    expect(toolOpacityForApproach(-50, 200)).toBe(TOOL_FLOOR_OPACITY);
    expect(TOOL_FLOOR_OPACITY).toBeGreaterThan(0);
  });

  it("do not fade when the drag began already in range", () => {
    expect(toolOpacityForApproach(-10, 0)).toBe(1);
  });
});

describe("tools dim early in a turn and are back before it settles", () => {
  const turning = springEasing({ visualDuration: 0.24, bounce: 0.08 });
  const keyframes = toolDipKeyframes(1, turning.timeAtProgress);
  const dimmed = keyframes.filter((keyframe) => keyframe.opacity === TOOL_TURN_OPACITY);

  it("run forward in time so the browser accepts them", () => {
    const offsets = keyframes.map((keyframe) => keyframe.offset);

    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(offsets[0]).toBe(0);
    expect(offsets.at(-1)).toBe(1);
  });

  it("begin where the tools were and end fully visible", () => {
    expect(toolDipKeyframes(0.6, turning.timeAtProgress)[0].opacity).toBe(0.6);
    expect(keyframes.at(-1)?.opacity).toBe(1);
  });

  it("stay dim only while the turn is between a fifth and a half of the way round", () => {
    const [start, end] = dimmed.map((keyframe) => keyframe.offset);

    expect(turning.timeAtProgress(TOOL_TURN_DIM.from)).toBeCloseTo(start);
    expect(turning.timeAtProgress(TOOL_TURN_DIM.to)).toBeCloseTo(end);
  });

  it("are dimmed well before the clock's midpoint, which a spring reaches near the finish", () => {
    const [, end] = dimmed.map((keyframe) => keyframe.offset);

    expect(end).toBeLessThan(0.5);
  });

  it("are fully back before the turn settles", () => {
    const restored = keyframes.find((keyframe, index) => index > 0 && keyframe.opacity === 1);

    expect(restored?.offset).toBeLessThan(1);
  });
});
