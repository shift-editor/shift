import { forwardRef, useEffect, useRef, useState } from "react";
import type { GlyphName } from "@shift/types";
import { Input } from "@shift/ui";
import type { GlyphNameInputProps } from "@/types/glyphCatalog";
import { useEditor } from "@/workspace/WorkspaceContext";
import { getGlyphInfo } from "@/workspace/glyphInfo";

export const GlyphNameInput = forwardRef<HTMLInputElement, GlyphNameInputProps>(
  function GlyphNameInput({ glyph, onFinished }, ref) {
    const editor = useEditor();
    const glyphInfo = getGlyphInfo();
    const glyphName = glyph.name;
    const [draft, setDraft] = useState(glyphName);
    const draftRef = useRef(glyphName);

    useEffect(() => {
      draftRef.current = glyphName;
      setDraft(glyphName);
    }, [glyphName]);

    const updateDraft = (next: GlyphName): void => {
      draftRef.current = next;
      setDraft(next);
    };

    const commit = (): GlyphName | null => {
      const next = draftRef.current.trim() as GlyphName;
      if (next === glyphName) {
        updateDraft(glyphName);
        return null;
      }

      if (!next || editor.font.recordForName(next)) {
        updateDraft(glyphName);
        return null;
      }

      const resolved = glyphInfo.getGlyphByName(next);
      editor.font.updateGlyphIdentity(glyph.id, next, resolved ? [resolved.codepoint] : []);
      return next;
    };

    return (
      <Input
        ref={ref}
        aria-label="Glyph name"
        value={draft}
        onChange={(event) => updateDraft(event.currentTarget.value as GlyphName)}
        onBlur={() => onFinished(commit())}
        onKeyDown={(event) => {
          event.nativeEvent.stopImmediatePropagation();

          switch (event.key) {
            case "Enter":
              event.currentTarget.blur();
              return;
            case "Escape":
              updateDraft(glyphName);
              event.currentTarget.blur();
              return;
          }

          if (event.metaKey && event.key === "a") {
            event.currentTarget.select();
          }
        }}
        className="h-7 w-full truncate bg-input text-center font-ui text-xs font-normal text-muted focus:ring-inset"
      />
    );
  },
);

GlyphNameInput.displayName = "GlyphNameInput";
