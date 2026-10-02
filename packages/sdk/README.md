# `@shift-editor/sdk`

Browser-safe Shift editor runtime and React UI. The SDK contains the real Shift geometry, interpolation, rendering, and editing models; it does not include Electron, filesystem access, persistence, or a workspace server.

## Install

```sh
pnpm add @shift-editor/sdk react react-dom @base-ui-components/react
```

Import the stylesheet explicitly when using the supplied UI. Add `fonts.css` only when the page does not already load Inter and JetBrains Mono:

```ts
import "@shift-editor/sdk/style.css";
import "@shift-editor/sdk/fonts.css";
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
  type SystemClipboard,
} from "@shift-editor/sdk";
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

## Host capabilities

`ShiftCapabilities` and its observation types describe the host-neutral live application API shared by protocol adapters and future plugin hosts. Browser integrations may implement the same contract with `"memory"` sessions; Electron and MCP are not part of the SDK contract.

## Custom chrome

Use individual primitives when the standard desktop-like shell is not appropriate:

```tsx
import {
  EditorToolbar,
  GlyphSidebar,
  ShiftEditor,
  ShiftEditorRoot,
  VariationSidebar,
} from "@shift-editor/sdk/ui";

export function CustomEditor({ session }: { session: MemoryFontSession }) {
  return (
    <ShiftEditorRoot>
      <EditorToolbar session={session} />
      <VariationSidebar session={session} />
      <ShiftEditor session={session} />
      <GlyphSidebar session={session} />
    </ShiftEditorRoot>
  );
}
```

`ShiftEditorRoot` is the style scope: the SDK stylesheet only applies inside it, and menus and tooltips mount inside it rather than in the page body.

## Theming

Editor colors and fonts read `--shift-*` custom properties, falling back to Shift's light palette. Set them on the root, or on any ancestor:

```css
.my-editor {
  --shift-color-chrome: #1f1f1f;
  --shift-color-surface: #262626;
  --shift-color-primary: #f5f5f5;
  --shift-font-ui: "IBM Plex Sans", sans-serif;
}
```

Color tokens use the names Shift's own UI uses (`--shift-color-background`, `--shift-color-surface`, `--shift-color-chrome`, `--shift-color-primary`, `--shift-color-accent`, …). The page's own Tailwind or CSS variables do not affect the editor.

## Tools

Memory sessions offer Select and Hand. Choose which appear, in order; the first becomes active and an empty list makes the session view-only:

```ts
createMemoryFontSession({ source, clipboard, tools: ["hand"] });
```

Sidebar toggle buttons are omitted when their callbacks are not supplied.

## Session capabilities

- `preview`: rendering and inspection only.
- `memory`: browser-owned state and local coordinate edits with Select and Hand. Authoring tools and metric edits need workspace authority and are not offered.
- `workspace`: host-coordinated structural mutation, history, persistence, and export.

`createMemoryFontSession` always creates a `memory` session. It does not create a fake workspace identity or provide persistence, upload, filesystem, undo/redo, or export behavior.

## SSR and client loading

Types and the root entry may be imported by shared code. Create sessions and mount React editor components only in a browser client boundary (`"use client"` in Next.js, or an equivalent client-only component). Do not create a session during server rendering.

## Lifecycle

A page may create multiple independent sessions. Each owns its editor and font model. Call `session.dispose()` when unmounting; disposal is idempotent. Do not reuse a disposed session.

## API stability

The public surface is the root entry, `/ui`, `style.css`, and `fonts.css`, recorded in `api/*.api.md`. `Editor`, `Font`, and `Glyph` are exported as `@beta` types: their members may change between minor versions while the SDK is pre-1.0.
