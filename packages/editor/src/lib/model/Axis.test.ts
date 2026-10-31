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
import { Axis } from "./Axis";
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

describe("an axis builds its edited records", () => {
  it("moves a continuous axis's bounds and default", () => {
    const weight = openFont().axis(WEIGHT)!;

    expect(weight.withMinimum(200).kind).toEqual({
      kind: "continuous",
      minimum: 200,
      default: 400,
      maximum: 900,
    });
    expect(weight.withMaximum(700).kind).toMatchObject({ minimum: 100, maximum: 700 });
    expect(weight.withDefault(500).kind).toMatchObject({ minimum: 100, default: 500 });
  });

  it("leaves a discrete axis's range to its values", () => {
    const italic = openFont().axis(ITALIC)!;

    expect(italic.withMinimum(-1)).toBe(italic.record);
    expect(italic.withMaximum(2)).toBe(italic.record);
    expect(italic.withDefault(1).kind).toEqual({
      kind: "discrete",
      values: [0, 0.5, 1],
      default: 1,
    });
  });

  it("turns a range into its bounds and default as ascending values, each once", () => {
    const optical = openFont().axis(OPTICAL)!;

    expect(openFont().axis(WEIGHT)!.withKind("discrete").kind).toEqual({
      kind: "discrete",
      values: [100, 400, 900],
      default: 400,
    });
    expect(optical.withKind("discrete").kind).toEqual({
      kind: "discrete",
      values: [12],
      default: 12,
    });
  });

  it("turns discrete values into the range from the smallest to the largest", () => {
    const italic = openFont().axis(ITALIC)!;

    expect(italic.withKind("continuous")).toEqual({
      ...italic.record,
      kind: { kind: "continuous", minimum: 0, default: 0, maximum: 1 },
    });
    expect(italic.withKind("discrete")).toBe(italic.record);
  });
});

describe("an axis builds its edited style labels", () => {
  function labelled(): Axis {
    const weight = openFont().axis(WEIGHT)!;
    const withValue = new Axis(weight.withNewLabel(400, "value"));
    return new Axis(withValue.withNewLabel(700, "range"));
  }

  it("adds value and range labels last, named New style", () => {
    expect(labelled().labels).toMatchObject([
      { name: "New style", value: 400, range: null, elidable: false },
      { name: "New style", value: 700, range: { minimum: 700, maximum: 700 }, elidable: false },
    ]);
  });

  it("renames, moves and links one label, leaving the others", () => {
    const axis = labelled();
    const [regular, bold] = axis.labels;
    const renamed = new Axis(axis.withLabelName(regular!.id, "Regular"));
    const moved = new Axis(renamed.withLabelValue(bold!.id, 650));

    expect(moved.withLabelLinkedValue(regular!.id, 700).labels).toMatchObject([
      { name: "Regular", value: 400, linkedValue: 700 },
      { name: "New style", value: 650 },
    ]);
    expect(moved.withLabelLinkedValue(regular!.id, null).labels[0]!.linkedValue).toBeUndefined();
  });

  it("moves one end of a label's range, reading a missing end as its value", () => {
    const axis = labelled();
    const [regular, bold] = axis.labels;

    expect(axis.withLabelRange(regular!.id, { maximum: 450 }).labels[0]!.range).toEqual({
      minimum: 400,
      maximum: 450,
    });
    expect(axis.withLabelRange(bold!.id, { minimum: 600 }).labels[1]!.range).toEqual({
      minimum: 600,
      maximum: 700,
    });
  });

  it("keeps at most one elidable label", () => {
    const axis = labelled();
    const [regular, bold] = axis.labels;
    const regularElided = new Axis(axis.withLabelElidable(regular!.id, true));

    expect(
      regularElided.withLabelElidable(bold!.id, true).labels.map(({ elidable }) => elidable),
    ).toEqual([false, true]);
    expect(
      regularElided.withLabelElidable(regular!.id, false).labels.map(({ elidable }) => elidable),
    ).toEqual([false, false]);
  });

  it("removes one label", () => {
    const axis = labelled();
    const [regular, bold] = axis.labels;

    expect(axis.withoutLabel(regular!.id).labels.map(({ id }) => id)).toEqual([bold!.id]);
  });
});

describe("an axis builds its edited fields", () => {
  it("renames, retags and hides the axis, keeping its range", () => {
    const weight = openFont().axis(WEIGHT)!;
    const renamed = new Axis(weight.withName("Thickness"));
    const retagged = new Axis(renamed.withTag("THCK"));

    expect(retagged.withHidden(true)).toEqual({
      ...weight.record,
      name: "Thickness",
      tag: "THCK",
      hidden: true,
    });
  });
});
