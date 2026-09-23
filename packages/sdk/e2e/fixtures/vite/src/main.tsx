import React from "react";
import { createRoot } from "react-dom/client";
import {
  createMemoryFontSession,
  signal as rootSignal,
  type MemoryFontSource,
} from "@shift-editor/sdk";
import { signal as subpathSignal } from "@shift-editor/sdk/signals";
import { ShiftEditorChrome } from "@shift-editor/sdk/ui";
import "@shift-editor/sdk/style.css";
import "./host.css";

const axisId = "axis_weight";
const source = {
  font: {
    metadata: { familyName: "Packed SDK Test" },
    metrics: { unitsPerEm: 1000 },
    metricDefinitions: [],
    glyphs: [],
    sources: [
      {
        id: "source_regular",
        name: "Regular",
        location: { values: { [axisId]: 400 } },
        metricValues: [],
      },
    ],
    axes: [
      {
        id: axisId,
        tag: "wght",
        name: "Weight",
        role: "external",
        axisType: "continuous",
        minimum: 100,
        default: 400,
        maximum: 900,
        labels: [],
        hidden: false,
      },
    ],
    axisMappings: [],
    axisMappingBases: [],
    namedInstances: [],
  },
  records: [],
  read: () => Promise.resolve([]),
  glyphPreviews: () => Promise.resolve([]),
} as unknown as MemoryFontSource;

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
let editorDisposals = 0;
let fontDisposals = 0;
const destroyEditor = lifecycle.editor.destroy.bind(lifecycle.editor);
const disposeFont = lifecycle.font.dispose.bind(lifecycle.font);
lifecycle.editor.destroy = () => {
  editorDisposals += 1;
  destroyEditor();
};
lifecycle.font.dispose = () => {
  fontDisposals += 1;
  disposeFont();
};
lifecycle.dispose();
lifecycle.dispose();

window.shiftSdkHarness = {
  runtimeIdentity: rootSignal === subpathSignal,
  setFirstAxis(value: number) {
    first.editor.setExternalLocation(
      new Map([[axisId, value]]) as Parameters<typeof first.editor.setExternalLocation>[0],
    );
  },
  firstAxis: () => first.editor.externalLocation.get(axisId as never),
  secondAxis: () => second.editor.externalLocation.get(axisId as never) ?? 400,
  disposalCounts: () => ({ editor: editorDisposals, font: fontDisposals }),
};

const root = createRoot(document.getElementById("root")!);
root.render(<ShiftEditorChrome session={first} />);

window.addEventListener("beforeunload", () => {
  root.unmount();
  first.dispose();
  second.dispose();
});

declare global {
  interface Window {
    shiftSdkHarness: {
      runtimeIdentity: boolean;
      setFirstAxis(value: number): void;
      firstAxis(): number | undefined;
      secondAxis(): number;
      disposalCounts(): { editor: number; font: number };
    };
  }
}
