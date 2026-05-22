import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogPortal,
  DialogPopup,
  DialogTitle,
  Input,
  Separator,
} from "@shift/ui";
import type { GlyphHandle } from "@shift/bridge";
import type { SearchResult } from "@shift/glyph-info";
import type { GlyphName } from "@shift/types";
import { useFocusZone } from "@/context/FocusZoneContext";
import { fallbackGlyphNameForUnicode, formatCodepointAsUPlus } from "@/lib/utils/unicode";
import { getGlyphInfo } from "@/store/store";

interface NewGlyphDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenGlyph: (handle: GlyphHandle) => void;
}

export function NewGlyphDialog({ open, onOpenChange, onOpenGlyph }: NewGlyphDialogProps) {
  const glyphInfo = getGlyphInfo();
  const { lockToZone, unlock } = useFocusZone();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return undefined;

    lockToZone("modal");
    setQuery("");
    return () => unlock();
  }, [open, lockToZone, unlock]);

  const results = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    return glyphInfo.search(trimmed, 8);
  }, [glyphInfo, query]);

  const resolved = useMemo(() => resolveGlyphInput(query), [query]);

  const openHandle = useCallback(
    (handle: GlyphHandle) => {
      onOpenGlyph(handle);
      onOpenChange(false);
    },
    [onOpenChange, onOpenGlyph],
  );

  const commit = useCallback(() => {
    if (!resolved) return;
    openHandle(resolved);
  }, [openHandle, resolved]);

  const stopPropagation = useCallback((event: React.KeyboardEvent) => {
    event.nativeEvent.stopImmediatePropagation();
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          initialFocus={false}
          finalFocus={false}
          className="w-[360px] max-w-[calc(100vw-32px)] shadow-sm bg-panel"
        >
          <form
            className="flex flex-col gap-3 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              commit();
            }}
            onKeyDown={stopPropagation}
            onKeyUp={stopPropagation}
          >
            <DialogTitle className="text-sm font-medium text-primary">New Glyph</DialogTitle>

            <Input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Name, Unicode, or character"
              className="h-8 text-sm"
              autoFocus
            />

            {resolved && <GlyphDraftPreview handle={resolved} />}

            {results.length > 0 && (
              <>
                <Separator />
                <div role="listbox" className="max-h-64 overflow-y-auto scrollbar-hidden">
                  {results.map((result) => (
                    <GlyphSearchRow
                      key={result.codepoint}
                      result={result}
                      onSelect={() => openHandle(handleFromSearchResult(result))}
                    />
                  ))}
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" variant="primary" disabled={!resolved}>
                Create
              </Button>
            </div>
          </form>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}

function GlyphDraftPreview({ handle }: { readonly handle: GlyphHandle }) {
  return (
    <div className="flex items-center gap-3 rounded border border-line-subtle bg-surface px-3 py-2">
      <div className="flex h-12 w-12 items-center justify-center text-3xl text-primary">
        {handle.unicode === undefined
          ? handle.name.slice(0, 2)
          : String.fromCodePoint(handle.unicode)}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-primary">{handle.name}</div>
        <div className="text-xs text-muted">
          {handle.unicode === undefined
            ? "Unencoded glyph"
            : formatCodepointAsUPlus(handle.unicode)}
        </div>
      </div>
    </div>
  );
}

function GlyphSearchRow({
  result,
  onSelect,
}: {
  readonly result: SearchResult;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      className="flex w-full cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-left text-xs text-primary hover:bg-muted/10"
      onMouseDown={(event) => {
        event.preventDefault();
        event.nativeEvent.stopImmediatePropagation();
        onSelect();
      }}
    >
      <span className="flex w-10 justify-center text-3xl">
        {String.fromCodePoint(result.codepoint)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">
          {result.glyphName ?? fallbackGlyphNameForUnicode(result.codepoint)}
        </span>
        <span className="text-xs text-muted">{formatCodepointAsUPlus(result.codepoint)}</span>
      </span>
    </button>
  );
}

function resolveGlyphInput(input: string): GlyphHandle | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const codepoint = parseCodepointInput(trimmed);
  if (codepoint !== null) return handleFromCodepoint(codepoint);

  const glyph = getGlyphInfo().getGlyphByName(trimmed);
  if (glyph) return { name: glyph.name as GlyphName, unicode: glyph.codepoint };

  return { name: trimmed as GlyphName };
}

function handleFromSearchResult(result: SearchResult): GlyphHandle {
  return {
    name: (result.glyphName ?? fallbackGlyphNameForUnicode(result.codepoint)) as GlyphName,
    unicode: result.codepoint,
  };
}

function handleFromCodepoint(codepoint: number): GlyphHandle {
  const name = getGlyphInfo().getGlyphName(codepoint) ?? fallbackGlyphNameForUnicode(codepoint);
  return { name: name as GlyphName, unicode: codepoint };
}

function parseCodepointInput(input: string): number | null {
  const character = Array.from(input);
  if (character.length === 1) return character[0].codePointAt(0) ?? null;

  const normalized = input.replace(/^U\+/i, "").replace(/^0x/i, "").replace(/^uni/i, "");
  if (!/^[0-9a-f]{4,6}$/i.test(normalized)) return null;

  const codepoint = Number.parseInt(normalized, 16);
  if (!Number.isFinite(codepoint) || codepoint < 0 || codepoint > 0x10ffff) return null;
  return codepoint;
}
