import type { Axis, AxisDefinition } from "@shift/types";

/**
 * Provides practical starter definitions for Shift's registered-axis menu.
 *
 * @remarks
 * These ranges are authoring conveniences, not defaults mandated by the
 * OpenType registry. Authors may change them after creating the axis.
 */
export const REGISTERED_AXIS_PRESETS = [
  axisPreset("wght", "Weight", 100, 400, 900),
  axisPreset("wdth", "Width", 50, 100, 200),
  axisPreset("opsz", "Optical Size", 8, 14, 144),
  axisPreset("slnt", "Slant", -20, 0, 20),
  axisPreset("ital", "Italic", 0, 0, 1),
] satisfies readonly AxisDefinition[];

/**
 * Returns a custom-axis starter definition with an unused name and tag.
 *
 * @param axes - current authored axes whose names and tags must not be reused.
 * @returns a fresh definition using the next available `AX`-prefixed private tag.
 * @throws {Error} when every two-character base-36 suffix is already claimed.
 */
export function nextCustomAxisDefinition(
  axes: readonly Pick<Axis, "name" | "tag">[],
): AxisDefinition {
  const names = new Set(axes.map((axis) => axis.name));
  const tags = new Set(axes.map((axis) => axis.tag));
  const name = nextCustomAxisName(names);

  for (let sequence = 1; sequence < 36 ** 2; sequence += 1) {
    const suffix = sequence.toString(36).toUpperCase().padStart(2, "0");
    const tag = `AX${suffix}`;
    if (tags.has(tag)) continue;

    return axisPreset(tag, name, 0, 0, 100);
  }

  throw new Error("No custom axis tags remain in the AX namespace");
}

function nextCustomAxisName(names: ReadonlySet<string>): string {
  const baseName = "Custom Axis";
  if (!names.has(baseName)) return baseName;

  for (let sequence = 2; ; sequence += 1) {
    const name = `${baseName} ${sequence}`;
    if (!names.has(name)) return name;
  }
}

function axisPreset(
  tag: string,
  name: string,
  minimum: number,
  defaultValue: number,
  maximum: number,
): AxisDefinition {
  return {
    tag,
    name,
    role: "external",
    axisType: "continuous",
    minimum,
    default: defaultValue,
    maximum,
    labels: [],
    hidden: false,
  };
}
