import { useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  Input,
  Search,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  X,
} from "@shift/ui";
import type { GlyphName } from "@shift/types";
import type { AddGlyphsTab, GlyphSet } from "@/types/glyphSet";
import { useFontSession } from "@/workspace/WorkspaceContext";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { nameForUnicode, parseGlyphList, selectedGlyphNames } from "./glyphSetSelection";

interface AddGlyphsDialogProps {
  onOpenChange: (open: boolean) => void;
}

const PREVIEW_LIMIT = 120;
const glyphInfo = getGlyphInfo();
const builtInSets: GlyphSet[] = glyphInfo.listCharsets().map((charset) => ({
  id: charset.id,
  name: charset.name,
  scope: "builtIn",
  glyphNames: glyphInfo.getCharsetCodepoints(charset.id).map((cp) => nameForUnicode(cp, glyphInfo)),
}));

export function AddGlyphsDialog({ onOpenChange }: AddGlyphsDialogProps) {
  const session = useFontSession();
  const font = session.font;
  const [tab, setTab] = useState<AddGlyphsTab>("sets");
  const [selectedSetIds, setSelectedSetIds] = useState<ReadonlySet<string>>(new Set());
  const [individualNames, setIndividualNames] = useState<readonly GlyphName[]>([]);
  const [builderText, setBuilderText] = useState("");
  const [query, setQuery] = useState("");
  const [inspectedName, setInspectedName] = useState<GlyphName | null>(null);
  const [status, setStatus] = useState<"editing" | "adding">("editing");
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseGlyphList(builderText, glyphInfo), [builderText]);
  const selectedNames = useMemo(
    () => selectedGlyphNames(builtInSets, selectedSetIds, individualNames, parsed.glyphNames),
    [selectedSetIds, individualNames, parsed.glyphNames],
  );
  const missingNames = selectedNames.filter((name) => !font.entryForName(name));
  const visibleSets = builtInSets.filter((set) =>
    set.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const searchResults = useMemo(() => {
    if (!query.trim()) return glyphInfo.getAllGlyph().slice(0, PREVIEW_LIMIT);
    return glyphInfo
      .search(query, PREVIEW_LIMIT)
      .map((result) => glyphInfo.getGlyph(result.codepoint))
      .filter((glyph) => glyph !== null);
  }, [query]);
  const displayedNames =
    tab === "sets"
      ? selectedGlyphNames(builtInSets, selectedSetIds, [], [])
      : tab === "glyphs"
        ? searchResults.map((glyph) => glyph.name as GlyphName)
        : parsed.glyphNames;
  const inspectedGlyph = inspectedName ? glyphInfo.getGlyphByName(inspectedName) : null;

  async function addGlyphs(): Promise<void> {
    if (status === "adding" || missingNames.length === 0 || parsed.errors.length > 0) return;
    setStatus("adding");
    setError(null);

    try {
      await font.createGlyphs(missingNames);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add glyphs");
      setStatus("editing");
    }
  }

  function toggleSet(id: string): void {
    const next = new Set(selectedSetIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedSetIds(next);
    setInspectedName(null);
  }

  function toggleGlyph(name: GlyphName): void {
    setIndividualNames((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (status !== "adding") onOpenChange(open);
      }}
    >
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="fixed left-1/2 top-1/2 flex h-175 max-h-screen w-275 max-w-full -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border border-line-subtle">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-line-subtle px-5">
            <DialogTitle className="text-lg font-medium text-primary">Character Sets</DialogTitle>
            <Tooltip>
              <TooltipTrigger>
                <DialogClose
                  variant="icon"
                  aria-label="Close character sets"
                  disabled={status === "adding"}
                >
                  <X className="h-5 w-5" />
                </DialogClose>
              </TooltipTrigger>
              <TooltipContent>Close character sets</TooltipContent>
            </Tooltip>
          </header>

          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value as AddGlyphsTab);
              setQuery("");
              setInspectedName(null);
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line-subtle px-5 py-3">
              <TabsList className="gap-2">
                <TabsTab value="glyphs" size="md">
                  Glyphs
                </TabsTab>
                <TabsTab value="sets" size="md">
                  Sets
                </TabsTab>
                <TabsTab value="builder" size="md">
                  Builder
                </TabsTab>
              </TabsList>
              {tab !== "builder" && (
                <Input
                  aria-label={tab === "sets" ? "Search sets" : "Search glyphs"}
                  placeholder="Search..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  size="md"
                  icon={<Search className="h-4 w-4 text-muted" />}
                  iconPosition="left"
                  className="w-72"
                />
              )}
            </div>

            <TabsPanel value="sets" className="flex min-h-0 flex-1 data-[hidden]:hidden">
              <aside
                aria-label="Character sets"
                className="w-72 shrink-0 overflow-y-auto border-r border-line-subtle p-4"
              >
                <h3 className="mb-2 text-sm font-medium text-primary">Built-in</h3>
                {visibleSets.map((set) => (
                  <div
                    key={set.id}
                    className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-hover/50"
                  >
                    <Checkbox
                      checked={selectedSetIds.has(set.id)}
                      onCheckedChange={() => toggleSet(set.id)}
                      aria-label={`Select ${set.name}`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSetIds(new Set([...selectedSetIds, set.id]));
                        setInspectedName(null);
                      }}
                      className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-sm text-primary focus-visible:ring-1 focus-visible:ring-accent"
                    >
                      <span className="truncate">{set.name}</span>
                      <span className="text-xs text-muted">{set.glyphNames.length}</span>
                    </button>
                  </div>
                ))}
                {visibleSets.length === 0 && <p className="text-sm text-muted">No sets found.</p>}
              </aside>
              <GlyphTiles
                names={displayedNames}
                inspectedName={inspectedName}
                onInspect={setInspectedName}
              />
            </TabsPanel>

            <TabsPanel value="glyphs" className="flex min-h-0 flex-1 data-[hidden]:hidden">
              <div className="min-w-0 flex-1 overflow-y-auto p-5">
                <p className="mb-3 text-sm text-muted">Select individual glyphs to add.</p>
                <div className="grid grid-cols-5 gap-3">
                  {searchResults.map((glyph) => (
                    <div key={glyph.codepoint} className="relative">
                      <GlyphTile name={glyph.name as GlyphName} onInspect={setInspectedName} />
                      <Checkbox
                        checked={individualNames.includes(glyph.name as GlyphName)}
                        onCheckedChange={() => toggleGlyph(glyph.name as GlyphName)}
                        aria-label={`Select ${glyph.name}`}
                        className="absolute right-2 top-2"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </TabsPanel>

            <TabsPanel
              value="builder"
              className="min-h-0 flex-1 overflow-y-auto data-[hidden]:hidden"
            >
              <label htmlFor="glyph-builder" className="mb-2 block text-sm font-medium">
                Paste glyph names or Unicode
              </label>
              <Textarea
                id="glyph-builder"
                value={builderText}
                onChange={(event) => setBuilderText(event.target.value)}
                placeholder="/A /B U+00C1 .notdef"
                className="min-h-28"
              />
              <p className="mt-2 text-sm text-muted">
                Separate entries with spaces, commas, or new lines. Component recipes are not
                supported yet.
              </p>
              {parsed.errors.map((message, index) => (
                <p key={index} role="alert" className="mt-2 text-sm text-error">
                  {message}
                </p>
              ))}
              <GlyphTiles
                names={displayedNames}
                inspectedName={inspectedName}
                onInspect={setInspectedName}
              />
            </TabsPanel>
          </Tabs>

          {inspectedName && (
            <div className="absolute inset-x-72 top-28 bottom-17 z-10 overflow-y-auto bg-surface p-5 shadow-lg">
              <Button size="sm" onClick={() => setInspectedName(null)}>
                Back to glyphs
              </Button>
              <div className="mt-4 flex flex-wrap gap-6">
                <div className="flex h-52 w-52 items-center justify-center rounded bg-surface-muted text-8xl text-primary">
                  {inspectedGlyph ? String.fromCodePoint(inspectedGlyph.codepoint) : "—"}
                </div>
                <dl className="min-w-52 flex-1 text-sm text-primary">
                  <Detail label="Glyph name" value={inspectedName} />
                  <Detail
                    label="Unicode"
                    value={
                      inspectedGlyph
                        ? `U+${inspectedGlyph.codepoint.toString(16).toUpperCase().padStart(4, "0")}`
                        : "Unencoded"
                    }
                  />
                  <Detail label="Script" value={inspectedGlyph?.script ?? "—"} />
                  <Detail label="Category" value={inspectedGlyph?.category ?? "—"} />
                  <Detail label="In font" value={font.entryForName(inspectedName) ? "Yes" : "No"} />
                </dl>
              </div>
            </div>
          )}

          <footer className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-t border-line-subtle px-5">
            <div className="text-sm text-primary">
              <span>
                {selectedSetIds.size} {selectedSetIds.size === 1 ? "set" : "sets"} selected ·{" "}
                {selectedNames.length} glyphs · {missingNames.length} new
              </span>
              {error && (
                <p role="alert" className="text-error">
                  {error}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => onOpenChange(false)} disabled={status === "adding"}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={addGlyphs}
                disabled={
                  status === "adding" || missingNames.length === 0 || parsed.errors.length > 0
                }
              >
                {status === "adding" ? "Adding..." : "Add"}
              </Button>
            </div>
          </footer>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}

function GlyphTiles({
  names,
  inspectedName,
  onInspect,
}: {
  names: readonly GlyphName[];
  inspectedName: GlyphName | null;
  onInspect: (name: GlyphName) => void;
}) {
  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-5">
      {names.length === 0 && (
        <p className="text-sm text-muted">Select a set or glyph to preview.</p>
      )}
      <div className="grid grid-cols-5 gap-3">
        {names.slice(0, PREVIEW_LIMIT).map((name) => (
          <GlyphTile
            key={name}
            name={name}
            onInspect={onInspect}
            selected={inspectedName === name}
          />
        ))}
      </div>
      {names.length > PREVIEW_LIMIT && (
        <p className="mt-4 text-sm text-muted">
          Showing the first {PREVIEW_LIMIT} of {names.length} glyphs.
        </p>
      )}
    </div>
  );
}

function GlyphTile({
  name,
  onInspect,
  selected = false,
}: {
  name: GlyphName;
  onInspect: (name: GlyphName) => void;
  selected?: boolean;
}) {
  const glyph = glyphInfo.getGlyphByName(name);
  return (
    <button
      type="button"
      aria-label={`Inspect ${name}`}
      aria-pressed={selected}
      onClick={() => onInspect(name)}
      className="flex aspect-square min-w-0 flex-col items-center justify-center rounded bg-surface-muted text-primary hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="text-5xl leading-tight">
        {glyph ? String.fromCodePoint(glyph.codepoint) : "·"}
      </span>
      <span className="max-w-full truncate px-1 text-xs text-muted">{name}</span>
    </button>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line-subtle py-3">
      <dt>{label}</dt>
      <dd className="text-right text-muted">{value}</dd>
    </div>
  );
}
