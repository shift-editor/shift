import { afterEach, describe, expect, it } from "vitest";
import type { Axis, AxisId, AxisMapping, Source } from "@shift/types";
import { mintAxisId, mintAxisLabelId, mintAxisMappingId, mintSourceId } from "@shift/types";
import { type Designspace, externalAxisLocationFromLocation } from "@shift/editor/variation";
import { openDesignspace } from "@/testing/designspace";
import { sourceCreationIssue, sourceLocation, suggestedSourceName } from "./sourceCreation";

function weightAxis(): Axis {
  return {
    id: mintAxisId(),
    tag: "wght",
    name: "Weight",
    role: "external",
    kind: { kind: "continuous", minimum: 100, default: 400, maximum: 900 },
    labels: [
      {
        id: mintAxisLabelId(),
        name: "Bold",
        value: 700,
        elidable: false,
      },
    ],
    hidden: false,
  };
}

function source(name: string, values: Record<AxisId, number>): Source {
  return {
    id: mintSourceId(),
    name,
    location: { values },
    metricValues: {},
    role: "master",
  };
}

const opened: (() => void)[] = [];
afterEach(() => {
  for (const dispose of opened.splice(0)) dispose();
});

async function designspace(
  axes: Axis[],
  sources: Source[],
  mappings: AxisMapping[] = [],
): Promise<Designspace> {
  const open = await openDesignspace({ axes, sources, mappings });
  opened.push(() => open.dispose());
  return open.designspace;
}

describe("source creation", () => {
  it("parses finite axis fields and rejects incomplete numeric input", async () => {
    const axis = weightAxis();

    expect([...(sourceLocation([axis], { [axis.id]: "550" }) ?? [])]).toEqual([[axis.id, 550]]);
    expect(sourceLocation([axis], { [axis.id]: "not a number" })).toBeNull();
    expect(sourceLocation([axis], { [axis.id]: "" })).toBeNull();
  });

  it("treats omitted coordinates as axis defaults when checking duplicate masters", async () => {
    const axis = weightAxis();
    const regular = source("Regular", {} as Record<AxisId, number>);

    expect(
      sourceCreationIssue("Book", { [axis.id]: "400" }, await designspace([axis], [regular])),
    ).toEqual({
      kind: "location",
      sourceId: regular.id,
      message: "Regular already exists at this location",
    });
  });

  it("maps external coordinates before checking duplicate design locations", async () => {
    const axis = weightAxis();
    const black = source("Black", { [axis.id]: 800 } as Record<AxisId, number>);
    const at = (value: number) => ({ values: { [axis.id]: value } });
    const point = (input: number, output: number) => ({ input: at(input), output: at(output) });
    // External 900 maps to design 800.
    const mapping: AxisMapping = {
      id: mintAxisMappingId(),
      name: "Weight",
      inputs: [axis.id],
      outputs: [axis.id],
      points: [point(100, 100), point(400, 400), point(900, 800)],
    };

    expect(
      sourceCreationIssue(
        "Book",
        { [axis.id]: "900" },
        await designspace([axis], [black], [mapping]),
      ),
    ).toMatchObject({ kind: "location", sourceId: black.id });
  });

  it("targets the axis whose coordinate is invalid", async () => {
    const axis = weightAxis();

    expect(sourceCreationIssue("Book", { [axis.id]: "" }, await designspace([axis], []))).toEqual({
      kind: "axis",
      axisId: axis.id,
      message: "Enter a number for Weight",
    });
  });

  it("targets invalid source names independently of location", async () => {
    const axis = weightAxis();

    expect(sourceCreationIssue("", { [axis.id]: "400" }, await designspace([axis], []))).toEqual({
      kind: "name",
      message: "Enter a source name",
    });
  });

  it("suggests unique names from axis labels", async () => {
    const axis = weightAxis();
    const location = { values: { [axis.id]: 700 } as Record<AxisId, number> };
    const bold = source("Bold", { [axis.id]: 800 } as Record<AxisId, number>);

    expect(suggestedSourceName([axis], [], externalAxisLocationFromLocation(location))).toBe(
      "Bold",
    );
    expect(suggestedSourceName([axis], [bold], externalAxisLocationFromLocation(location))).toBe(
      "Bold 2",
    );
  });
});
