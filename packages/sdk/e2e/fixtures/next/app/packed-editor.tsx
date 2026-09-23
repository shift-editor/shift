"use client";

import {
  createMemoryFontSession,
  type MemoryFontSession,
  type MemoryFontSource,
} from "@shift-editor/sdk";
import { ShiftEditorChrome } from "@shift-editor/sdk/ui";
import { useEffect, useState } from "react";

const source = {
  font: {
    metadata: { familyName: "Packed Next Test" },
    metrics: { unitsPerEm: 1000 },
    metricDefinitions: [],
    glyphs: [],
    sources: [],
    axes: [],
    axisMappings: [],
    axisMappingBases: [],
    namedInstances: [],
  },
  records: [],
  read: () => Promise.resolve([]),
  glyphPreviews: () => Promise.resolve([]),
} as unknown as MemoryFontSource;

export function PackedEditor() {
  const [session, setSession] = useState<MemoryFontSession | null>(null);

  useEffect(() => {
    let clipboardText = "";
    const next = createMemoryFontSession({
      source,
      clipboard: {
        readText: () => Promise.resolve(clipboardText),
        writeText: (value) => {
          clipboardText = value;
          return Promise.resolve();
        },
      },
    });
    setSession(next);
    return () => next.dispose();
  }, []);

  return session ? <ShiftEditorChrome session={session} /> : <p>Loading editor…</p>;
}
