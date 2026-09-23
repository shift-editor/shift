import { describe, expect, it } from "vitest";
import { asNamedInstanceId, asSourceId } from "@shift/types";
import { createVariationOutlineState, variationOutlineReducer } from "./variationOutlineState";

describe("variation outline visibility intent", () => {
  it("keeps an explicit source visible when its group is disabled", () => {
    const sourceId = asSourceId("source-a");
    let state = variationOutlineReducer(createVariationOutlineState(), {
      type: "toggleSourceGroup",
      sourceIds: [sourceId],
    });
    state = variationOutlineReducer(state, { type: "toggleSource", sourceId, selected: false });
    state = variationOutlineReducer(state, { type: "toggleSource", sourceId, selected: false });
    state = variationOutlineReducer(state, { type: "toggleSourceGroup", sourceIds: [] });

    expect(state.sources.groupActive).toBe(false);
    expect(state.sources.explicitIds).toEqual(new Set([sourceId]));
  });

  it("forgets a hidden source after it leaves the editing selection", () => {
    const sourceId = asSourceId("source-a");
    let state = variationOutlineReducer(createVariationOutlineState(), {
      type: "toggleSource",
      sourceId,
      selected: true,
    });
    state = variationOutlineReducer(state, {
      type: "reconcileSelectedSources",
      selectedIds: new Set(),
    });

    expect(state.hiddenSelectedSourceIds).toEqual(new Set());
  });

  it("keeps an explicit instance visible when its group is disabled", () => {
    const instanceId = asNamedInstanceId("instance-a");
    let state = variationOutlineReducer(createVariationOutlineState(), {
      type: "toggleInstanceGroup",
      instanceIds: [instanceId],
    });
    state = variationOutlineReducer(state, { type: "toggleInstance", instanceId });
    state = variationOutlineReducer(state, { type: "toggleInstance", instanceId });
    state = variationOutlineReducer(state, { type: "toggleInstanceGroup", instanceIds: [] });

    expect(state.instances.groupActive).toBe(false);
    expect(state.instances.explicitIds).toEqual(new Set([instanceId]));
  });
});
