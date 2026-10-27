import { describe, expect, it } from "vitest";
import { asNamedInstanceId, asSourceId, type SourceId } from "@shift/types";
import { OutlineVisibility } from "./OutlineVisibility";

const active = asSourceId("source-active");
const bold = asSourceId("source-bold");
const light = asSourceId("source-light");
const instanceA = asNamedInstanceId("instance-a");
const instanceB = asNamedInstanceId("instance-b");

function sourceIds(visibility: OutlineVisibility, editing: readonly SourceId[] = []) {
  return visibility.sourceTargets(active, new Set([active, ...editing])).targets.sources();
}

describe("outline visibility keeps row choices apart from show-all", () => {
  it("keeps a source turned on from its row when show-all is turned off", () => {
    const visibility = OutlineVisibility.NONE.toggleSourceGroup([light])
      .toggleSource(light, false)
      .toggleSource(light, false)
      .toggleSourceGroup([]);

    expect(visibility.sourceGroupActive).toBe(false);
    expect(sourceIds(visibility)).toEqual([light]);
  });

  it("keeps an instance turned on from its row when show-all is turned off", () => {
    const visibility = OutlineVisibility.NONE.toggleInstanceGroup([instanceA])
      .toggleInstance(instanceA)
      .toggleInstance(instanceA)
      .toggleInstanceGroup([]);

    expect(visibility.instanceGroupActive).toBe(false);
    expect(visibility.instanceTargets().targets.instances()).toEqual([instanceA]);
  });

  it("hides one show-all source without turning show-all off", () => {
    const visibility = OutlineVisibility.NONE.toggleSourceGroup([bold, light]).toggleSource(
      bold,
      false,
    );

    expect(sourceIds(visibility)).toEqual([light]);
    expect(visibility.sourceGroupActive).toBe(true);
  });

  it("drops show-all's sources when show-all is turned off", () => {
    const visibility = OutlineVisibility.NONE.toggleSourceGroup([bold, light]).toggleSourceGroup(
      [],
    );

    expect(sourceIds(visibility)).toEqual([]);
  });
});

describe("outline visibility follows the sources being edited", () => {
  it("outlines sources being edited but never the active source", () => {
    expect(sourceIds(OutlineVisibility.NONE, [bold])).toEqual([bold]);
  });

  it("hides a source being edited when it is toggled off from its row", () => {
    expect(sourceIds(OutlineVisibility.NONE.toggleSource(bold, true), [bold])).toEqual([]);
  });

  it("forgets the hidden choice once the source stops being edited", () => {
    const visibility = OutlineVisibility.NONE.toggleSource(bold, true).keepHiddenAmong(new Set());

    expect(sourceIds(visibility, [bold])).toEqual([bold]);
  });

  it("keeps the same value when no hidden choice is forgotten", () => {
    const visibility = OutlineVisibility.NONE.toggleSource(bold, true);

    expect(visibility.keepHiddenAmong(new Set([bold]))).toBe(visibility);
  });
});

describe("outline targets list each outline once, in order", () => {
  it("lists row choices, then sources being edited, then show-all's", () => {
    const visibility = OutlineVisibility.NONE.toggleSourceGroup([bold, light, active])
      .toggleSource(light, false)
      .toggleSource(light, false);

    expect(sourceIds(visibility, [bold])).toEqual([light, bold]);
  });

  it("lists row-chosen instances before show-all's", () => {
    const visibility = OutlineVisibility.NONE.toggleInstance(instanceB).toggleInstanceGroup([
      instanceA,
      instanceB,
    ]);

    expect(visibility.instanceTargets().targets.instances()).toEqual([instanceB, instanceA]);
  });
});
