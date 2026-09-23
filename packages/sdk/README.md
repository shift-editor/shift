# `@shift-editor/sdk`

Browser-safe Shift editor runtime and React UI. The SDK contains the real Shift geometry, interpolation, rendering, and editing models; it does not include Electron, filesystem access, persistence, or a workspace server.

## Install

```sh
pnpm add @shift-editor/sdk react
```

Import the stylesheet explicitly when using the supplied UI:

```ts
import "@shift-editor/sdk/style.css";
```

## Create a memory session

A host provides a browser-owned `MemoryFontSource`. Creating a session does not load or place a glyph.

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  createMemoryFontSession,
  type MemoryFontSession,
  type MemoryFontSource,
} from "@shift-editor/sdk";
import type { SystemClipboard } from "@shift-editor/sdk/clipboard";
import { ShiftEditorChrome } from "@shift-editor/sdk/ui";
import "@shift-editor/sdk/style.css";

const clipboard: SystemClipboard = {
  readText: () => navigator.clipboard.readText(),
  writeText: (value) => navigator.clipboard.writeText(value),
};

export function FontEditor({ source }: { source: MemoryFontSource }) {
  const [session, setSession] = useState<MemoryFontSession | null>(null);

  useEffect(() => {
    const next = createMemoryFontSession({ source, clipboard });
    let active = true;

    void next.font.loadGlyph(source.records[0]!.id).then((glyph) => {
      if (!active) return;
      const sourceId = source.font.sources[0]!.id;
      next.editor.selectSource(sourceId);
      const node = next.editor.scene.createNode({
        kind: "glyph",
        glyphId: glyph.id,
        sourceId,
        position: { x: 0, y: 0 },
      });
      next.editor.editing.enter(node.id);
      setSession(next);
    });

    return () => {
      active = false;
      next.dispose();
    };
  }, [source]);

  return session ? <ShiftEditorChrome session={session} /> : null;
}
```

The source owns its loaded font data. If it has a `dispose` operation—for example, a future worker-backed WASM source—the host disposes it separately from the editor session.

## Custom chrome

Use individual primitives when the standard desktop-like shell is not appropriate:

```tsx
import { EditorToolbar, GlyphSidebar, ShiftEditor, VariationSidebar } from "@shift-editor/sdk/ui";

export function CustomEditor({ session }: { session: MemoryFontSession }) {
  return (
    <div className="shift-editor-chrome">
      <EditorToolbar session={session} />
      <VariationSidebar session={session} />
      <ShiftEditor session={session} />
      <GlyphSidebar session={session} />
    </div>
  );
}
```

Sidebar toggle buttons are omitted when their callbacks are not supplied.

## Session capabilities

- `preview`: rendering and inspection only.
- `memory`: browser-owned state and local coordinate edits. Select and Hand are enabled; Pen and Shape remain visible but disabled because structural edits require workspace authority.
- `workspace`: host-coordinated structural mutation, history, persistence, and export.

`createMemoryFontSession` always creates a `memory` session. It does not create a fake workspace identity or provide persistence, upload, filesystem, undo/redo, or export behavior.

## SSR and client loading

Types and browser-safe model exports may be imported by shared code. Create sessions and mount React editor components only in a browser client boundary (`"use client"` in Next.js, or an equivalent client-only component). Do not create a session during server rendering.

## Lifecycle

A page may create multiple independent sessions. Each owns its editor and font model. Call `session.dispose()` when unmounting; disposal is idempotent. Do not reuse a disposed session.
