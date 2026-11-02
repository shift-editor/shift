"use client";

import { createMemoryFontSession, type MemoryFontSession } from "@shift-editor/sdk";
import { ShiftEditorChrome } from "@shift-editor/sdk/ui";
import { useEffect, useState } from "react";
import { interASource } from "../shared/interSource";

const source = interASource();

export function PackedEditor() {
  const [session, setSession] = useState<MemoryFontSession | null>(null);

  useEffect(() => {
    let clipboardText = "";
    let active = true;
    let opened: MemoryFontSession | null = null;

    void (async () => {
      const next = await createMemoryFontSession({
        source,
        clipboard: {
          readText: () => Promise.resolve(clipboardText),
          writeText: (value) => {
            clipboardText = value;
            return Promise.resolve();
          },
        },
      });
      opened = next;
      if (!active) {
        next.dispose();
        return;
      }
      const glyph = await next.font.loadGlyph(next.font.glyphRecords()[0]!.id);
      if (!active) return;
      const sourceId = next.font.sources[0]!.id;
      next.editor.selectSource(sourceId);
      const node = next.editor.scene.createNode({
        kind: "glyph",
        glyphId: glyph.id,
        sourceId,
        position: { x: 0, y: 0 },
      });
      next.editor.editing.enter(node.id);
      setSession(next);
    })();

    return () => {
      active = false;
      opened?.dispose();
    };
  }, []);

  return session ? <ShiftEditorChrome session={session} /> : <p>Loading editor…</p>;
}
