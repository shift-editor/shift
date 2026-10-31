import { afterEach, describe, expect, it } from "vitest";
import {
  asAxisId,
  asSourceId,
  type Axis as AxisRecord,
  type AxisId,
  type AxisKind,
} from "@shift/types";
import { createMemoryFontSession } from "../../createMemoryFontSession";
import type { SystemClipboard } from "../clipboard";
import type { Font } from "./Font";

class MemoryClipboard implements SystemClipboard {
  writeText(): Promise<void> {
    return Promise.resolve();
  }

  readText(): Promise<string> {
    return Promise.resolve("");
  }
}

const WEIGHT = asAxisId("axis_wght");
const OPTICAL = asAxisId("axis_opsz");
const ITALIC = asAxisId("axis_ital");

function axis(id: AxisId, tag: string, kind: AxisKind): AxisRecord {
  return { id, tag, name: tag, role: "external", kind, labels: [], hidden: false };
}

let dispose: (() => void) | null = null;

afterEach(() => {
  if (dispose) dispose();
  dispose = null;
});

/** A font with a weight range, a fixed optical size and a discrete italic axis. */
function openFont(): Font {
  const session = createMemoryFontSession({
    clipboard: new MemoryClipboard(),
    source: {
      font: {
        metadata: { familyName: "Axes" },
        metrics: { unitsPerEm: 1000 },
        metricDefinitions: [],
        kerning: { groups: [], sources: [] },
        glyphs: [],
        sources: [
          {
            id: asSourceId("source_regular"),
            name: "Regular",
            location: { values: {} },
            metricValues: {},
            role: "master",
          },
        ],
        axes: [
          axis(WEIGHT, "wght", { kind: "continuous", minimum: 100, default: 400, maximum: 900 }),
          axis(OPTICAL, "opsz", { kind: "continuous", minimum: 12, default: 12, maximum: 12 }),
          axis(ITALIC, "ital", { kind: "discrete", values: [0, 0.5, 1], default: 0 }),
        ],
        axisMappings: [],
        axisMappingBases: [],
        namedInstances: [],
      },
      records: [],
      read: () => Promise.resolve([]),
      glyphPreviews: () => Promise.resolve([]),
    },
  });
  dispose = session.dispose;
  return session.font;
}

describe("a font's axes answer their range as shift-font does", () => {
  it("a continuous axis ranges over its authored bounds", () => {
    const weight = openFont().axis(WEIGHT);

    expect(weight).toMatchObject({
      isDiscrete: false,
      minimum: 100,
      default: 400,
      maximum: 900,
      values: [],
      varies: true,
    });
  });

  it("a discrete axis ranges from its smallest to its largest value", () => {
    const italic = openFont().axis(ITALIC);

    expect(italic).toMatchObject({
      isDiscrete: true,
      minimum: 0,
      default: 0,
      maximum: 1,
      values: [0, 0.5, 1],
      varies: true,
    });
  });

  it("an axis fixed at one value does not vary", () => {
    expect(openFont().axis(OPTICAL)).toMatchObject({ minimum: 12, maximum: 12, varies: false });
  });

  it("a continuous axis accepts finite values inside its range", () => {
    const weight = openFont().axis(WEIGHT)!;

    expect([100, 650, 900, 950, Number.NaN].map((value) => weight.accepts(value))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("a discrete axis accepts only its listed values", () => {
    const italic = openFont().axis(ITALIC)!;

    expect([0, 0.5, 0.25, 1].map((value) => italic.accepts(value))).toEqual([
      true,
      true,
      false,
      true,
    ]);
  });

  it("normalizes each side of the default to its own extent", () => {
    const weight = openFont().axis(WEIGHT)!;

    expect([100, 250, 400, 650, 900].map((value) => weight.normalize(value))).toEqual([
      -1, -0.5, 0, 0.5, 1,
    ]);
  });

  it("the designspace hands out the same axes, in authored order", () => {
    const font = openFont();

    expect(font.designspace.axes.map(({ tag }) => tag)).toEqual(["wght", "opsz", "ital"]);
    expect(font.designspace.axis(ITALIC)).toBe(font.axis(ITALIC));
  });
});
