import { useEffect, useState } from "react";
import type { GlyphName } from "@shift/types";
import { Input } from "@shift/ui";
import type { GlyphCatalogItem } from "@/context/GlyphCatalogContext";
import { useEditor } from "@/workspace/WorkspaceContext";
import { getGlyphInfo } from "@/workspace/glyphInfo";

export function GlyphNameInput({ glyph }: { readonly glyph: GlyphCatalogItem }) {
  const editor = useEditor();
  const glyphInfo = getGlyphInfo();
  const glyphName = glyph.name;
  const [draft, setDraft] = useState(glyphName);

  useEffect(() => {
    setDraft(glyphName);
  }, [glyphName]);

  const commit = () => {
    const next = draft.trim() as GlyphName;
    if (next === glyphName) {
      setDraft(glyphName);
      return;
    }

    if (!next || editor.font.recordForName(next)) {
      setDraft(glyphName);
      return;
    }

    const resolved = glyphInfo.getGlyphByName(next);
    editor.font.updateGlyphIdentity(glyph.id, next, resolved ? [resolved.codepoint] : []);
  };

  return (
    <Input
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value as GlyphName)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.nativeEvent.stopImmediatePropagation();

        switch (event.key) {
          case "Enter":
            event.currentTarget.blur();
            return;
          case "Escape":
            setDraft(glyphName);
            event.currentTarget.blur();
            return;
        }

        if (event.metaKey && event.key === "a") {
          event.currentTarget.select();
        }
      }}
      className="h-7 w-full truncate text-center text-xs text-muted-foreground focus:ring-inset read-only:cursor-default read-only:bg-transparent read-only:focus:ring-0"
    />
  );
}
