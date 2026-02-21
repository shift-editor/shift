import { expect } from "vitest";

export const expectDefined = <T>(value: T | null | undefined, label = "value"): T => {
  expect(value, `${label} should be defined`).toBeDefined();
  expect(value, `${label} should not be null`).not.toBeNull();
  if (value === null || value === undefined) {
    throw new Error(`${label} should be defined`);
  }
  return value;
};

export const expectAt = <T>(items: readonly T[], index: number, label?: string): T => {
  return expectDefined(items[index], label ?? `item at index ${index}`);
};
