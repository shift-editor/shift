import React from "react";
import { createRoot } from "react-dom/client";
import { createMemoryFontSession, scenePoint, type MemoryFontSession } from "@shift-editor/sdk";
import { ShiftEditorChrome } from "@shift-editor/sdk/ui";
import "@shift-editor/sdk/style.css";
import "@shift-editor/sdk/fonts.css";
import { interASource } from "../shared/interSource";
import "./host.css";

interface Point {
  readonly x: number;
  readonly y: number;
}

const source = interASource();
const weightAxis = source.font.axes.find((axis) => axis.tag === "wght")!;
const regular = source.font.sources.find((candidate) => candidate.name === "Regular")!;
const glyphRecord = source.records[0]!;

let clipboardText = "";
const clipboard = {
  readText: () => Promise.resolve(clipboardText),
  writeText: (value: string) => {
    clipboardText = value;
    return Promise.resolve();
  },
};

const first = createMemoryFontSession({ source, clipboard });
const second = createMemoryFontSession({ source, clipboard });
const lifecycle = createMemoryFontSession({ source, clipboard });
lifecycle.dispose();
let secondDisposeThrew = false;
try {
  lifecycle.dispose();
} catch {
  secondDisposeThrew = true;
}

async function placeGlyph(session: MemoryFontSession): Promise<void> {
  const glyph = await session.font.loadGlyph(glyphRecord.id);
  session.editor.selectSource(regular.id);
  const node = session.editor.scene.createNode({
    kind: "glyph",
    glyphId: glyph.id,
    sourceId: regular.id,
    position: { x: 0, y: 0 },
  });
  session.editor.editing.enter(node.id);
}

function regularLayer() {
  return first.editor.glyphForId(glyphRecord.id)?.layerForSource(regular.id) ?? null;
}

let glyphPlaced = false;

window.shiftSdkHarness = {
  glyphPlaced: () => glyphPlaced,
  onCurvePointId() {
    const contour = regularLayer()?.contours[0];
    return contour?.points.find((point) => point.pointType === "onCurve")?.id ?? null;
  },
  pointPosition(pointId: string) {
    const point = regularLayer()?.point(pointId as never);
    return point ? { x: point.x, y: point.y } : null;
  },
  pointScreenPosition(pointId: string) {
    const point = regularLayer()?.point(pointId as never);
    return point ? first.editor.sceneToScreen(scenePoint(point.x, point.y)) : null;
  },
  zoom: () => first.editor.zoom,
  pan: () => ({ ...first.editor.pan }),
  cameraSize: () => ({
    width: first.editor.camera.logicalWidth,
    height: first.editor.camera.logicalHeight,
  }),
  firstAxis: () => first.editor.externalLocation.get(weightAxis.id as never),
  secondAxis: () =>
    second.editor.externalLocation.get(weightAxis.id as never) ?? weightAxis.default,
  disposedSession: () => ({
    toolReleased: lifecycle.editor.toolCell.peek() === null,
    toolsUnregistered: lifecycle.editor.toolRegistryCell.peek().size === 0,
    secondDisposeThrew,
  }),
};

const root = createRoot(document.getElementById("root")!);
root.render(<ShiftEditorChrome session={first} />);
void placeGlyph(first).then(() => {
  glyphPlaced = true;
});

window.addEventListener("beforeunload", () => {
  root.unmount();
  first.dispose();
  second.dispose();
});

declare global {
  interface Window {
    shiftSdkHarness: {
      glyphPlaced(): boolean;
      onCurvePointId(): string | null;
      pointPosition(pointId: string): Point | null;
      pointScreenPosition(pointId: string): Point | null;
      zoom(): number;
      pan(): Point;
      cameraSize(): { width: number; height: number };
      firstAxis(): number | undefined;
      secondAxis(): number;
      disposedSession(): {
        toolReleased: boolean;
        toolsUnregistered: boolean;
        secondDisposeThrew: boolean;
      };
    };
  }
}
