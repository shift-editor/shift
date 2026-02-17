import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogPortal,
  DialogPopup,
  Input,
  Search,
  Separator,
} from "@shift/ui";
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

  const selectedColour = (index: number) =>
    index === selectedIndex ? "bg-accent/10 text-accent" : "text-primary hover:bg-muted/10";

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          initialFocus={false}
          finalFocus={false}
          className="max-w-[300px] shadow-sm bg-panel"
        >
          <div className="px-1 py-1.5" onKeyDown={handleKeyDown} onKeyUp={stopPropagation}>
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search "
              className="h-8 pl-8 bg-transparent text-sm focus:ring-0 focus:ring-transparent focus:outline-none"
              icon={<Search className="w-4 h-4 text-muted" />}
              iconPosition="left"
            />
            {results.length > 0 && (
              <>
                <Separator className="my-2" />
                <div
                  ref={listRef}
                  role="listbox"
                  className="mt-2 max-h-80 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                >
                  {results.map((result, index) => (
                    <div
                      key={result.codepoint}
                      role="option"
                      aria-selected={index === selectedIndex}
                      className={`flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-xs ${selectedColour(index)}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.nativeEvent.stopImmediatePropagation();
                        commitSelection(result.codepoint);
                      }}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      <div className="flex items-center justify-center gap-2">
                        <span className="w-12 text-[40px] text-center text-base">
                          {glyphChar(result.codepoint)}
                        </span>
                        <div className="flex flex-col gap-1">
                          <span className="font-medium font-sans text-sm">
                            {result.glyphName ?? "—"}
                          </span>
                          <span className="font-sans text-xs">
                            {formatCodepointAsUPlus(result.codepoint)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
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
