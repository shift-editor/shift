import type { NodeId, PointId } from "@shift/types";
import { describe, expect, it } from "vitest";
import { ShiftStore } from "@/lib/store/ShiftStore";
import { currentSelectionId, type ShiftEditorRecord } from "@/types";
import { Selection } from "./Selection";

const asNodeId = (id: string): NodeId => id as NodeId;
const asPointId = (id: string): PointId => id as PointId;

describe("Selection", () => {
  it("starts empty", () => {
    const selection = new Selection(new ShiftStore<ShiftEditorRecord>());

    expect(selection.ids).toEqual([]);
    expect(selection.hasSelection()).toBe(false);
  });

  it("selects ordered unique ids", () => {
    const store = new ShiftStore<ShiftEditorRecord>();
    const selection = new Selection(store);
    const nodeId = asNodeId("node_one");
    const pointId = asPointId("point_abc");

    selection.select([nodeId, pointId, nodeId]);

    expect(selection.ids).toEqual([nodeId, pointId]);
    expect(store.get(currentSelectionId)).toMatchObject({ ids: [nodeId, pointId] });
    expect(selection.hasSelection()).toBe(true);
  });

  it("adds, removes, and toggles ids", () => {
    const selection = new Selection(new ShiftStore<ShiftEditorRecord>());
    const nodeId = asNodeId("node_one");
    const pointId = asPointId("point_abc");

    selection.add(nodeId);
    selection.add(pointId);
    expect(selection.ids).toEqual([nodeId, pointId]);

    selection.toggle(nodeId);
    expect(selection.ids).toEqual([pointId]);
    expect(selection.has(nodeId)).toBe(false);

    selection.toggle(nodeId);
    expect(selection.ids).toEqual([pointId, nodeId]);

    selection.remove(pointId);
    expect(selection.ids).toEqual([nodeId]);
  });

  it("clears selected ids and updates the signal", () => {
    const store = new ShiftStore<ShiftEditorRecord>();
    const selection = new Selection(store);
    const nodeId = asNodeId("node_one");

    selection.select([nodeId]);
    expect(selection.stateCell.value.ids).toEqual([nodeId]);

    selection.clear();
    expect(selection.stateCell.value.ids).toEqual([]);
    expect(store.get(currentSelectionId)).toBeNull();
    expect(selection.hasSelection()).toBe(false);
  });
});
