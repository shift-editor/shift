import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBridge, type ShiftBridge } from "@shift/bridge";
import { mintContourId, mintGlyphId, mintLayerId, type LayerId } from "@shift/types";
import type { LayerReaderHost } from "@shared/host/ShiftHost";
import { layerReaderHost } from "../../../../preload/layerReaders";
import { WindowEngine } from "./WindowEngine";

/**
 * Releasing the store closes the window's reader, so the workspace can delete
 * the files on Windows, and keeps the session: the next read reopens it.
 */
describe("the window's engine releases its store", () => {
  let dir: string;
  let bridge: ShiftBridge;
  let layerId: LayerId;
  let open: number[];
  let layers: LayerReaderHost;
  let engine: WindowEngine;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shift-window-engine-"));
    const storePath = path.join(dir, "working.sqlite");
    bridge = createBridge();
    bridge.createUntitledWorkspace(storePath);
    const glyphId = mintGlyphId();
    layerId = mintLayerId();
    bridge.apply([
      { kind: "createGlyph", createGlyph: { glyphId, name: "A", unicodes: [65] } },
      {
        kind: "createGlyphLayer",
        createGlyphLayer: { layerId, glyphId, sourceId: bridge.getSources()[0]!.id },
      },
    ]);

    // Track which readers are open, as the files Windows holds.
    const host = layerReaderHost();
    open = [];
    layers = {
      ...host,
      open: (location) => {
        const reader = host.open(location);
        open.push(reader);
        return reader;
      },
      close: (reader) => {
        open = open.filter((held) => held !== reader);
        host.close(reader);
      },
    };
    engine = new WindowEngine(layers, {
      storeLocation: () => Promise.resolve({ kind: "working", storePath }),
      directory: () => Promise.resolve(bridge.encodedDirectory()),
    });
    await engine.reopen();
  });

  afterEach(() => {
    engine.dispose();
    bridge.closeWorkspace();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("holds nothing open once released, and reopens the store for the next edit", () => {
    engine.releaseStore();
    expect(open).toEqual([]);

    engine.beginEdit();
    const edited = engine.apply([
      { kind: "addContour", addContour: { layerId, contourId: mintContourId(), closed: true } },
    ]);
    engine.endEdit();

    expect(edited.layers.map((layer) => layer.layerId)).toContain(layerId);
    expect(open).toHaveLength(1);
  });
});
