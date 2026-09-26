import { describe, expect, it } from "vitest";
import { asNamedInstanceId, asSourceId } from "@shift/types";
import type { VariationOutlineAction, VariationOutlineState } from "@/types/variationOutline";
import {
  createVariationOutlineState,
  instanceOutlineTargets,
  sourceOutlineTargets,
  variationOutlineReducer,
} from "./variationOutlineState";

const active = asSourceId("source-active");
const bold = asSourceId("source-bold");
const light = asSourceId("source-light");
const instanceA = asNamedInstanceId("instance-a");
const instanceB = asNamedInstanceId("instance-b");

function reduce(...actions: VariationOutlineAction[]): VariationOutlineState {
  return actions.reduce(variationOutlineReducer, createVariationOutlineState());
}

function sourceIds(state: VariationOutlineState, editing: readonly (typeof active)[] = []) {
  return sourceOutlineTargets(state, active, new Set([active, ...editing])).targets.map((target) =>
    target.kind === "source" ? target.sourceId : null,
  );
}

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

describe("variation outline targets follow visibility intent", () => {
  it("outlines selected editing sources but never the active source", () => {
    expect(sourceIds(createVariationOutlineState(), [bold])).toEqual([bold]);
  });

  it("hides a selected editing source toggled off from its row", () => {
    const state = reduce({ type: "toggleSource", sourceId: bold, selected: true });

    expect(sourceIds(state, [bold])).toEqual([]);
  });

  it("outlines an unselected source toggled on from its row", () => {
    const state = reduce({ type: "toggleSource", sourceId: light, selected: false });

    expect(sourceIds(state)).toEqual([light]);
  });

  it("lists explicit, selected, then group sources once each", () => {
    const state = reduce(
      { type: "toggleSourceGroup", sourceIds: [bold, light, active] },
      { type: "toggleSource", sourceId: light, selected: false },
      { type: "toggleSource", sourceId: light, selected: false },
    );

    expect(sourceIds(state, [bold])).toEqual([light, bold]);
  });

  it("drops group sources when show-all is toggled off", () => {
    const state = reduce(
      { type: "toggleSourceGroup", sourceIds: [bold, light] },
      { type: "toggleSourceGroup", sourceIds: [] },
    );

    expect(sourceIds(state)).toEqual([]);
  });

  it("hides one group source without leaving the group", () => {
    const state = reduce(
      { type: "toggleSourceGroup", sourceIds: [bold, light] },
      { type: "toggleSource", sourceId: bold, selected: false },
    );

    expect(sourceIds(state)).toEqual([light]);
    expect(state.sources.groupActive).toBe(true);
  });

  it("lists explicit then group instances once each", () => {
    const state = reduce(
      { type: "toggleInstance", instanceId: instanceB },
      { type: "toggleInstanceGroup", instanceIds: [instanceA, instanceB] },
    );

    expect(instanceOutlineTargets(state).targets).toEqual([
      { kind: "instance", instanceId: instanceB },
      { kind: "instance", instanceId: instanceA },
    ]);
  });
});
