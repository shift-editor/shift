import { describe, expect, it } from "vitest";
import type { Axis, InterpolationBasis } from "@shift/types";
import { mintAxisId, mintSourceId } from "@shift/types";
import { signal } from "../signals";
import type { EngineVariation } from "../../types/font";
import {
  designAxisLocationFromLocation,
  externalAxisLocationFromRecord,
} from "../variation/location";
import { EngineVariationReader } from "./variation";

const axis: Axis = {
  id: mintAxisId(),
  tag: "wght",
  name: "Weight",
  role: "external",
  kind: { kind: "continuous", minimum: 100, default: 400, maximum: 900 },
  labels: [],
  hidden: false,
};

const basis: InterpolationBasis = {
  sourceIds: [mintSourceId(), mintSourceId()],
  designNormalization: [{ axisId: axis.id, minimum: 100, default: 400, maximum: 900 }],
  basis: { deltas: [{ region: [], values: new Float64Array([1, 0]) }] },
};

/** A session released under its reader: every read answers empty, as an unknown handle does. */
const released: EngineVariation = {
  sourceSetNumber: () => 0,
  sourceSetWeights: () => ({ weights: new Float64Array(), starts: [] }),
  designLocation: () => [],
  externalLocation: () => [],
};

describe("the engine's variation reader on a released session", () => {
  const reader = new EngineVariationReader(released, {
    axesCell: signal([axis]),
    mappingBasesCell: signal([]),
    sourcesCell: signal([]),
  });
  const location = designAxisLocationFromLocation({ values: { [axis.id]: 600 } });

  it("throws on a mapping with no coordinates instead of answering another reader's", () => {
    expect(() => reader.toDesign(externalAxisLocationFromRecord({ [axis.id]: 600 }))).toThrow(
      "the engine answered 0 coordinates for 1 axes",
    );
    expect(() => reader.toExternal(location)).toThrow("the engine answered 0 coordinates");
  });

  it("throws on weights for a set it does not have", () => {
    expect(() => reader.interpolationWeights(reader.sourceSet(basis), location)).toThrow(
      "the engine has no source set 0",
    );
  });
});
