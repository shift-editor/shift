import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogBackdrop, DialogPortal, DialogPopup, Input } from "@shift/ui";
import { formatCodepointAsUPlus } from "@/lib/utils/unicode";
import { getGlyphInfo } from "@/store/glyphInfo";
import type { SearchResult } from "@shift/glyph-info";
import { useFocusZone } from "@/context/FocusZoneContext";

interface GlyphFinderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (codepoint: number) => void;
}

function glyphChar(codepoint: number): string {
  try {
    return String.fromCodePoint(codepoint);
  } catch {
    return "";
  }
}

export function GlyphFinder({ open, onOpenChange, onSelect }: GlyphFinderProps) {
  const { lockToZone, unlock } = useFocusZone();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      lockToZone("modal");
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      return () => unlock();
    }
    unlock();
    return undefined;
  }, [open, lockToZone, unlock]);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    if (value.trim() === "") {
      setResults([]);
      setSelectedIndex(0);
      return;
    }
    const hits = getGlyphInfo().search(value, 50);
    setResults(hits);
    setSelectedIndex(0);
  }, []);

  const stopPropagation = useCallback((e: React.KeyboardEvent) => {
    e.nativeEvent.stopImmediatePropagation();
  }, []);

  const commitSelection = useCallback(
    (codepoint: number) => {
      onSelect(codepoint);
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.nativeEvent.stopImmediatePropagation();
      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          setSelectedIndex((prev) => {
            const next = Math.min(prev + 1, results.length - 1);
            scrollItemIntoView(next);
            return next;
          });
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          setSelectedIndex((prev) => {
            const next = Math.max(prev - 1, 0);
            scrollItemIntoView(next);
            return next;
          });
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (results.length > 0 && selectedIndex < results.length) {
            commitSelection(results[selectedIndex].codepoint);
          }
          break;
        }
      }
    },
    [results, selectedIndex, commitSelection],
  );

  const scrollItemIntoView = (index: number) => {
    requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;
      const item = list.children[index] as HTMLElement | undefined;
      item?.scrollIntoView({ block: "nearest" });
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup>
          <div className="p-3" onKeyDown={handleKeyDown} onKeyUp={stopPropagation}>
            <Input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search glyphs by name, unicode, category..."
              className="h-8 text-xs"
            />
            {results.length > 0 && (
              <div ref={listRef} role="listbox" className="mt-2 max-h-80 overflow-y-auto">
                {results.map((result, index) => (
                  <div
                    key={result.codepoint}
                    role="option"
                    aria-selected={index === selectedIndex}
                    className={`flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-xs ${
                      index === selectedIndex
                        ? "bg-accent/10 text-accent"
                        : "text-primary hover:bg-muted/10"
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.nativeEvent.stopImmediatePropagation();
                      commitSelection(result.codepoint);
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <span className="w-6 text-center text-base">{glyphChar(result.codepoint)}</span>
                    <span className="font-medium">{result.glyphName ?? "—"}</span>
                    <span className="text-muted truncate">{result.unicodeName ?? ""}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted">
                      {formatCodepointAsUPlus(result.codepoint)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {query.trim() !== "" && results.length === 0 && (
              <p className="mt-2 px-2 text-xs text-muted">No results found.</p>
            )}
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
