import { describe, expect, it } from "vitest";
import {
  mintGlyphId,
  mintNodeId,
  mintRunId,
  mintSourceId,
  type GlyphId,
  type SourceId,
} from "@shift/types";
import type { GlyphNodeRecord, TextRunNodeRecord } from "../../../types/records";
import type { PersistedSceneRecord, SceneReferences } from "../../../types/sceneState";
import type { TextRunRecord } from "../../../types/text";
import { characterTextItem, lineBreakTextItem } from "../../text/layout/types";
import { decodeSceneState, encodeSceneState, SCENE_PAYLOAD_VERSION } from "./scenePayload";

const glyphId = mintGlyphId();
const sourceId = mintSourceId();
const references: SceneReferences = {
  hasGlyph: (id: GlyphId) => id === glyphId,
  hasSource: (id: SourceId) => id === sourceId,
};

const letter = characterTextItem(65);
const lineBreak = lineBreakTextItem();
const run: TextRunRecord = {
  id: mintRunId(),
  type: "textrun",
  scope: "document",
  items: [letter, lineBreak],
};
const runNode: TextRunNodeRecord = {
  id: mintNodeId(),
  type: "node",
  kind: "textRun",
  parentId: null,
  index: "a0",
  position: { x: 0, y: 0 },
  runId: run.id,
  size: 1000,
};

function child(overrides: Partial<GlyphNodeRecord> = {}): GlyphNodeRecord {
  return {
    id: mintNodeId(),
    type: "node",
    kind: "glyph",
    parentId: runNode.id,
    index: "a0",
    position: { x: 0, y: 0 },
    glyphId,
    sourceId,
    itemId: letter.id,
    ...overrides,
  };
}

function roundTrip(records: readonly PersistedSceneRecord[]) {
  return decodeSceneState(encodeSceneState(records), references);
}

describe("decodeSceneState", () => {
  it("restores a run, its node, and its child glyph", () => {
    const edited = child();
    const restore = roundTrip([run, runNode, edited]);

    expect(restore.restored).toEqual([run, runNode, edited]);
    expect(restore.dropped).toEqual([]);
  });

  it.each([
    ["a missing glyph", { glyphId: mintGlyphId() }],
    ["a missing source", { sourceId: mintSourceId() }],
    ["a line break item", { itemId: lineBreak.id }],
    ["a missing run node", { parentId: mintNodeId() }],
  ])("drops a child glyph with %s", (_case, overrides) => {
    const stale = child(overrides);
    const restore = roundTrip([run, runNode, stale]);

    expect(restore.restored).toEqual([run, runNode]);
    expect(restore.dropped.map((record) => record.id)).toEqual([stale.id]);
  });

  it("drops a run node whose run is gone, with its child", () => {
    const orphan = child();
    const restore = roundTrip([runNode, orphan]);

    expect(restore.restored).toEqual([]);
    expect(restore.dropped.map((record) => record.id)).toEqual([runNode.id, orphan.id]);
  });

  it("keeps one child glyph per run", () => {
    const first = child();
    const second = child();
    const restore = roundTrip([run, runNode, first, second]);

    expect(restore.restored).toEqual([run, runNode, first]);
    expect(restore.dropped.map((record) => record.id)).toEqual([second.id]);
  });

  it("drops malformed records and node kinds this editor does not register", () => {
    const unregistered = { ...runNode, id: mintNodeId(), kind: "acme.guide" };
    const payload = JSON.stringify({
      records: [run, { ...runNode, size: "large" }, unregistered, { type: "page", id: "page_1" }],
    });
    const restore = decodeSceneState({ version: SCENE_PAYLOAD_VERSION, payload }, references);

    expect(restore.restored).toEqual([run]);
    expect(restore.dropped.map((record) => record.id)).toEqual([
      runNode.id,
      unregistered.id,
      "page_1",
    ]);
  });

  it("restores a child stored before its parent, parents first", () => {
    const edited = child();
    const restore = roundTrip([edited, run, runNode]);

    expect(restore.restored).toEqual([run, runNode, edited]);
  });

  it.each([
    ["an unknown version", { version: SCENE_PAYLOAD_VERSION + 1, payload: '{"records":[]}' }],
    ["text that is not JSON", { version: SCENE_PAYLOAD_VERSION, payload: "{" }],
  ])("restores nothing from %s", (_case, stored) => {
    const restore = decodeSceneState(stored, references);

    expect(restore.restored).toEqual([]);
    expect(restore.dropped).toHaveLength(1);
  });
});
