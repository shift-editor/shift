import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, foldKeymap, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useSignalState } from "@shift/editor/signals";
import { ShiftIcon } from "@shift/editor/ui";
import type {
  FeatureCodeSettings,
  FeatureDiagnostic,
  FeatureSymbol,
  GeneratedFeature,
} from "@shift/types";
import { Button, cn, Tooltip } from "@shift/ui";
import ErrorIcon from "@/assets/general/error.svg";
import Keep from "@/assets/general/keep.svg";
import WarningIcon from "@/assets/general/warning.svg";
import KeepFilled from "@/assets/general/keep-filled.svg";
import { getShiftHost } from "@/host/shiftHost";
import { useEditor, useFontSession } from "@/workspace/WorkspaceContext";
import { featureName } from "../featureNames";
import { feaHighlighting } from "./feaHighlighting";
import { featureCodeTheme } from "./featureCodeTheme";
import { featureDiagnostics, showFeatureDiagnostics } from "./featureDiagnostics";
import { FeatureCodeSync } from "./FeatureCodeSync";
import { generatedFeatureBlocks, revealGeneratedFeature } from "./generatedBlocks";
import { featureFolding } from "./featureFolding";
import { FeatureCodeSettingsMenu } from "./FeatureCodeSettingsMenu";
import { classHover } from "./classHover";
import { codeZoom, zoomCode } from "./codeZoom";
import { featureNavigation, revealRange, type FeatureNavigationHost } from "./featureNavigation";
import { ProblemsPanel } from "./ProblemsPanel";
import { ReferencesPanel, RenamePanel } from "./SymbolPanels";
import { enclosingEntries, featureOutline, type OutlineEntry } from "./featureOutline";

interface FeatureCodePanelProps {
  /** Receives the code editor once it exists, so the window can run menu commands in it. */
  readonly onView: (view: EditorView | null) => void;
  /** Receives the code's sync once it exists, so a save can apply typing that is still waiting. */
  readonly onSync: (sync: FeatureCodeSync | null) => void;
  /** Opens a glyph, by name, in the canvas. */
  readonly onOpenGlyph: (name: string) => void;
  /** Whether the window stays above other windows when it opens. */
  readonly initiallyPinned: boolean;
  readonly onPinnedChange: (pinned: boolean) => void;
}

/** The one panel docked under the code, if any. */
type Dock =
  | { readonly kind: "problems" }
  | { readonly kind: "references"; readonly symbol: FeatureSymbol }
  | { readonly kind: "rename"; readonly symbol: FeatureSymbol; readonly offset: number };

/**
 * The font's feature code in the feature code window: a grouped outline, the
 * code, and a status bar. Typing applies the code after a pause.
 */
export const FeatureCodePanel = ({
  onView,
  onSync,
  onOpenGlyph,
  initiallyPinned,
  onPinnedChange,
}: FeatureCodePanelProps) => {
  const [pinned, setPinned] = useState(initiallyPinned);
  const [outlineOpen, setOutlineOpenState] = useState(() => readOutlineOpen());
  const setOutlineOpen = (open: boolean) => {
    setOutlineOpenState(open);
    writeOutlineOpen(open);
  };
  const editor = useEditor();
  const familyName = useSignalState(useFontSession().catalog.familyNameCell) ?? "Untitled";
  const isMac = getShiftHost().platform === "darwin";
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [loaded, setLoaded] = useState<LoadedFeatureCode | null>(null);
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [problems, setProblems] = useState<readonly FeatureDiagnostic[]>([]);
  const [generated, setGenerated] = useState<readonly GeneratedFeature[]>([]);
  const syncRef = useRef<FeatureCodeSync | null>(null);
  const [settings, setSettings] = useState<FeatureCodeSettings | null>(null);
  const settingsRef = useRef<FeatureCodeSettings | null>(null);
  settingsRef.current = settings;
  const [dock, setDock] = useState<Dock | null>(null);
  const navigationRef = useRef<FeatureNavigationHost>({
    showReferences: (symbol) => setDock({ kind: "references", symbol }),
    startRename: (symbol, offset) => setDock({ kind: "rename", symbol, offset }),
    openGlyph: (name) => onOpenGlyph(name),
  });
  const featureRevision = useSignalState(editor.font.featureRevisionCell);
  // Glyph names generate features, so new or renamed glyphs change the generated blocks.
  const glyphs = useSignalState(editor.font.glyphEntriesCell);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([editor.font.featureSource(), editor.font.featureDiagnostics()]).then(
      ([source, diagnostics]) => {
        if (!cancelled) setLoaded({ source: source ?? "", diagnostics });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [editor]);

  useEffect(() => {
    const host = hostRef.current;
    if (!loaded || !host) return undefined;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: loaded.source,
        extensions: [
          lineNumbers(),
          featureFolding,
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          indentOnInput(),
          bracketMatching(),
          highlightSelectionMatches(),
          feaHighlighting,
          featureDiagnostics,
          generatedFeatureBlocks,
          featureCodeTheme,
          codeZoom(),
          classHover(editor),
          featureNavigation(editor, () => navigationRef.current, isMac),
          keymap.of([
            { key: "Mod-0", run: (view) => zoomCode(view, 0) },
            {
              key: "Mod-Shift-f",
              run: () => (void syncRef.current?.format(), true),
            },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...foldKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setText(update.state.doc.toString());
              syncRef.current?.edited();
            }
            if (update.selectionSet) setCursor(update.state.selection.main.head);
          }),
        ],
      }),
    });
    viewRef.current = view;
    onView(view);
    const actions = {
      onIgnore: (rule: string) => {
        const current = settingsRef.current;
        if (!current || current.ignoredRules.includes(rule)) return;
        changeSettings(`Ignore ${rule}`, {
          ...current,
          ignoredRules: [...current.ignoredRules, rule],
        });
      },
    };
    const sync = new FeatureCodeSync(
      view,
      editor,
      loaded.source,
      setProblems,
      setGenerated,
      actions,
    );
    syncRef.current = sync;
    onSync(sync);
    setText(loaded.source);
    setProblems(loaded.diagnostics);
    showFeatureDiagnostics(view, loaded.diagnostics, actions);
    return () => {
      sync.dispose();
      syncRef.current = null;
      onSync(null);
      view.destroy();
      viewRef.current = null;
      onView(null);
    };
  }, [editor, loaded, onView, onSync, isMac]);

  useEffect(() => {
    void syncRef.current?.refresh();
  }, [featureRevision, glyphs, loaded]);

  useEffect(() => {
    let cancelled = false;
    void editor.font.featureCodeSettings().then((next) => {
      if (!cancelled) setSettings(next);
    });
    return () => {
      cancelled = true;
    };
  }, [editor, featureRevision]);

  function changeSettings(label: string, next: FeatureCodeSettings): void {
    setSettings(next);
    editor.history.capture(label, () => editor.font.setFeatureCodeSettings(next));
  }

  const outline = useMemo(() => featureOutline(text), [text]);
  const path = enclosingEntries(outline, cursor);
  const position = cursorPosition(text, cursor);
  const jump = (entry: OutlineEntry) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      selection: { anchor: entry.from },
      effects: EditorView.scrollIntoView(entry.from, { y: "start", yMargin: 24 }),
    });
    view.focus();
  };

  return (
    <section aria-label="Feature code" className="flex h-full flex-col overflow-hidden bg-surface">
      <header
        className={cn(
          "titlebar-drag grid h-9 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center select-none",
          isMac ? "pl-20" : "pl-3.5",
        )}
      >
        <span className="flex items-center">
          <OutlineToggle open={outlineOpen} onToggle={() => setOutlineOpen(!outlineOpen)} />
        </span>
        <p className="truncate px-4 text-ui whitespace-nowrap">
          <span className="font-medium">Feature Code</span>
          <span className="text-muted"> — {familyName}</span>
        </p>
        <span className="flex justify-end pr-1.5">
          <Tooltip content="Pin window">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Pin window"
              aria-pressed={pinned}
              onClick={() => {
                setPinned(!pinned);
                onPinnedChange(!pinned);
              }}
            >
              {pinned ? (
                <KeepFilled aria-hidden className="size-3.5 text-accent" />
              ) : (
                <Keep aria-hidden className="size-3.5 text-icon-subtle" />
              )}
            </Button>
          </Tooltip>
        </span>
      </header>
      {/* The divider sits on the body, so the header's full 36px centres its row on the traffic lights. */}
      <div className="flex min-h-0 flex-1 border-t border-line-subtle">
        {outlineOpen ? (
          <Outline
            entries={outline}
            generated={generated}
            path={path}
            onJump={jump}
            onReveal={(tag) => {
              if (viewRef.current) revealGeneratedFeature(viewRef.current, tag);
            }}
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <nav
            aria-label="Breadcrumbs"
            className="flex h-7.5 shrink-0 items-center gap-1.5 overflow-hidden px-4 text-ui text-secondary"
          >
            {path.length === 0 ? <span>Top level</span> : null}
            {path.map((entry, index) => (
              <span key={entry.from} className="flex items-center gap-1.5">
                {index > 0 ? <span aria-hidden>›</span> : null}
                <button
                  type="button"
                  className={cn("hover:text-primary", index === path.length - 1 && "text-primary")}
                  onClick={() => jump(entry)}
                >
                  {breadcrumbLabel(entry)}
                </button>
              </span>
            ))}
          </nav>
          <div ref={hostRef} className="min-h-0 flex-1" />
          {dock ? (
            <DockedContent
              dock={dock}
              problems={problems}
              view={viewRef.current}
              onRename={async (symbol, offset, newName) => {
                const view = viewRef.current;
                if (!view) return false;
                const edits = await editor.font.renameFeatureSymbol(
                  view.state.doc.toString(),
                  offset,
                  newName,
                );
                if (!edits) return false;
                syncRef.current?.applyEdits(edits, `Rename ${symbol.name}`);
                return true;
              }}
              onClose={() => setDock(null)}
            />
          ) : null}
        </div>
      </div>
      <footer className="flex h-7 shrink-0 items-center gap-2 border-t border-line-subtle px-3 text-ui text-secondary">
        <ProblemCount
          diagnostics={problems}
          onToggle={() =>
            setDock((open) => (open?.kind === "problems" ? null : { kind: "problems" }))
          }
        />
        <CursorProblem diagnostic={problemAtCursor(problems, text, cursor)} />
        <span className="min-w-4 flex-1" />
        <div className="flex shrink-0 items-center gap-3.5">
          {settings ? (
            <FeatureCodeSettingsMenu
              settings={settings}
              onChange={changeSettings}
              onFormat={() => void syncRef.current?.format()}
            />
          ) : null}
          <span
            className="tabular-nums"
            aria-label={`Line ${position.line}, column ${position.column}`}
          >
            {position.line}:{position.column}
          </span>
          <span>FEA</span>
        </div>
      </footer>
    </section>
  );
};

interface DockedContentProps {
  readonly dock: Dock;
  readonly problems: readonly FeatureDiagnostic[];
  readonly view: EditorView | null;
  /** Renames a symbol; resolves false when the new name isn't valid. */
  readonly onRename: (symbol: FeatureSymbol, offset: number, newName: string) => Promise<boolean>;
  readonly onClose: () => void;
}

/** The panel `dock` names, wired to the code. */
const DockedContent = ({ dock, problems, view, onRename, onClose }: DockedContentProps) => {
  const reveal = (range: { readonly from: number; readonly to: number }) => {
    if (view) revealRange(view, range);
  };
  const lineAt = (offset: number) => {
    if (!view) return { number: 1, from: 0, text: "" };
    const { number, from, text } = view.state.doc.lineAt(Math.min(offset, view.state.doc.length));
    return { number, from, text };
  };
  switch (dock.kind) {
    case "problems":
      return (
        <ProblemsPanel
          diagnostics={problems}
          positionOf={(offset) => {
            const line = lineAt(offset);
            return { line: line.number, column: offset - line.from + 1 };
          }}
          onSelect={(diagnostic) => {
            if (!view) return;
            if (diagnostic.generatedTag) revealGeneratedFeature(view, diagnostic.generatedTag);
            else reveal(diagnostic);
          }}
          onClose={onClose}
        />
      );
    case "references":
      return (
        <ReferencesPanel symbol={dock.symbol} lineAt={lineAt} onSelect={reveal} onClose={onClose} />
      );
    case "rename":
      return (
        <RenamePanel
          key={`${dock.symbol.name}-${dock.offset}`}
          symbol={dock.symbol}
          onRename={(newName) => onRename(dock.symbol, dock.offset, newName)}
          onClose={() => {
            onClose();
            view?.focus();
          }}
        />
      );
  }
};

/** The font's feature code and the compiler's problems with it, read together. */
interface LoadedFeatureCode {
  readonly source: string;
  readonly diagnostics: readonly FeatureDiagnostic[];
}

interface OutlineProps {
  readonly entries: readonly OutlineEntry[];
  /** Features glyph names generate, listed after the written ones. */
  readonly generated: readonly GeneratedFeature[];
  /** The entries the cursor is inside, outermost first. */
  readonly path: readonly OutlineEntry[];
  readonly onJump: (entry: OutlineEntry) => void;
  /** Scrolls a generated feature's block into view. */
  readonly onReveal: (tag: string) => void;
}

/** Features with their lookups, then standalone lookups, classes, and setup; filtered by the search field. */
const Outline = ({ entries, generated, path, onJump, onReveal }: OutlineProps) => {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = (entry: OutlineEntry) =>
    needle === "" ||
    entry.name.toLowerCase().includes(needle) ||
    (featureName({ tag: entry.name })?.toLowerCase().includes(needle) ?? false);
  const features = entries.filter((entry) => entry.kind === "feature" && matches(entry));
  const lookups = entries.filter((entry) => entry.kind === "lookup" && matches(entry));
  const classes = entries.filter((entry) => entry.kind === "class" && matches(entry));
  const systems = entries.filter((entry) => entry.kind === "languagesystem");
  const generatedMatches = generated.filter(
    (feature) =>
      needle === "" ||
      feature.tag.includes(needle) ||
      (featureName({ tag: feature.tag })?.toLowerCase().includes(needle) ?? false),
  );
  const firstSystem = systems[0];
  const current = path.at(-1);

  return (
    <nav
      aria-label="Feature code outline"
      className="scrollbar-hidden flex w-50 shrink-0 flex-col overflow-y-auto border-r border-line-subtle py-2.5"
    >
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Go to symbol…"
        aria-label="Go to symbol"
        className="mx-2.5 mb-2.5 h-6 shrink-0 rounded bg-input px-2 text-ui text-primary outline-none placeholder:text-secondary focus-visible:ring-1 focus-visible:ring-accent"
      />
      <OutlineGroup title="Features" show={features.length + generatedMatches.length > 0}>
        {features.map((feature) => (
          <div key={feature.from} className="contents">
            <OutlineRow entry={feature} current={current} onJump={onJump}>
              <span className="w-8 shrink-0 font-mono text-xs text-primary">{feature.name}</span>
              <span className="min-w-0 flex-1 truncate text-secondary">
                {featureName({ tag: feature.name }) ?? ""}
              </span>
            </OutlineRow>
            {feature.children.map((lookup) => (
              <OutlineRow key={lookup.from} entry={lookup} current={current} onJump={onJump} inset>
                <span className="min-w-0 flex-1 truncate text-secondary">{lookup.name}</span>
              </OutlineRow>
            ))}
          </div>
        ))}
        {generatedMatches.map((feature) => (
          <button
            key={`generated-${feature.tag}`}
            type="button"
            className="flex h-6 shrink-0 items-center gap-2 border-l-2 border-transparent pr-3.5 pl-3 text-left text-ui hover:bg-hover/50"
            onClick={() => onReveal(feature.tag)}
          >
            <span className="w-8 shrink-0 font-mono text-xs text-secondary">{feature.tag}</span>
            <span className="min-w-0 flex-1 truncate text-secondary">
              {featureName({ tag: feature.tag }) ?? ""}
            </span>
            <span className="shrink-0 rounded bg-input px-1 text-xs text-secondary">
              {feature.on ? "auto" : "off"}
            </span>
          </button>
        ))}
      </OutlineGroup>
      <OutlineGroup title="Lookups" show={lookups.length > 0}>
        {lookups.map((lookup) => (
          <OutlineRow key={lookup.from} entry={lookup} current={current} onJump={onJump}>
            <span className="min-w-0 flex-1 truncate text-primary">{lookup.name}</span>
          </OutlineRow>
        ))}
      </OutlineGroup>
      <OutlineGroup title="Classes" show={classes.length > 0}>
        {classes.map((glyphClass) => (
          <OutlineRow key={glyphClass.from} entry={glyphClass} current={current} onJump={onJump}>
            <span className="min-w-0 flex-1 truncate text-primary">{glyphClass.name}</span>
            <span className="shrink-0 text-secondary">{glyphClass.count}</span>
          </OutlineRow>
        ))}
      </OutlineGroup>
      <OutlineGroup title="Setup" show={firstSystem !== undefined && needle === ""}>
        {firstSystem ? (
          <OutlineRow entry={firstSystem} current={current} onJump={onJump}>
            <span className="min-w-0 flex-1 truncate text-primary">Language systems</span>
            <span className="shrink-0 text-secondary">{systems.length}</span>
          </OutlineRow>
        ) : null}
      </OutlineGroup>
    </nav>
  );
};

interface OutlineToggleProps {
  readonly open: boolean;
  readonly onToggle: () => void;
}

/** Shows or hides the outline, drawn as the main window's sidebar toggle is. */
const OutlineToggle = ({ open, onToggle }: OutlineToggleProps) => (
  <Tooltip content="Toggle outline">
    <Button
      icon={<ShiftIcon name="sidebar-left" className="h-4.5 w-4.5" />}
      aria-label="Toggle outline"
      aria-pressed={open}
      variant="toolbar"
      size="icon-sm"
      className="h-7 w-7"
      onClick={onToggle}
    />
  </Tooltip>
);

interface OutlineGroupProps {
  readonly title: string;
  readonly show: boolean;
  readonly children: ReactNode;
}

const OutlineGroup = ({ title, show, children }: OutlineGroupProps) => {
  if (!show) return null;
  return (
    <div className="flex flex-col pb-2.5">
      <h3 className="px-3.5 pt-1.5 pb-1 text-xs font-medium text-secondary">{title}</h3>
      {children}
    </div>
  );
};

interface OutlineRowProps {
  readonly entry: OutlineEntry;
  readonly current: OutlineEntry | undefined;
  readonly onJump: (entry: OutlineEntry) => void;
  /** A lookup nested under its feature, lined up with the feature's name. */
  readonly inset?: boolean;
  readonly children: ReactNode;
}

const OutlineRow = ({ entry, current, onJump, inset, children }: OutlineRowProps) => {
  const isCurrent = entry === current;
  return (
    <button
      type="button"
      aria-current={isCurrent ? "location" : undefined}
      className={cn(
        "flex h-6 shrink-0 items-center gap-2 border-l-2 border-transparent pr-3.5 text-left text-ui hover:bg-hover/50",
        inset ? "pl-13" : "pl-3",
        isCurrent && "border-accent bg-surface-muted hover:bg-surface-muted",
      )}
      onClick={() => onJump(entry)}
    >
      {children}
    </button>
  );
};

/** How a block reads in the breadcrumbs: features by tag, lookups as `lookup Name`, classes by name. */
function breadcrumbLabel(entry: OutlineEntry): string {
  return entry.kind === "lookup" ? `lookup ${entry.name}` : entry.name;
}

/** One-based line and column of `offset` in `text`. */
function cursorPosition(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  return { line: before.split("\n").length, column: offset - lineStart + 1 };
}

interface ProblemCountProps {
  readonly diagnostics: readonly FeatureDiagnostic[];
  /** Shows or hides the list of problems. */
  readonly onToggle: () => void;
}

/** The status bar's error and warning counts, as Zed shows them: coloured icons that open the list. */
const ProblemCount = ({ diagnostics, onToggle }: ProblemCountProps) => {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  return (
    <Tooltip content="Show problems">
      <Button variant="ghost" size="sm" aria-label="Show problems" onClick={onToggle}>
        <span className="flex items-center gap-2.5 tabular-nums">
          <span className="flex items-center gap-1">
            <ErrorIcon
              aria-hidden
              className={cn("size-3.5", errors > 0 ? "text-error" : "text-icon-subtle")}
            />
            {errors}
          </span>
          <span className="flex items-center gap-1">
            <WarningIcon
              aria-hidden
              className={cn("size-3.5", warnings > 0 ? "text-canvas-orange" : "text-icon-subtle")}
            />
            {warnings}
          </span>
        </span>
      </Button>
    </Tooltip>
  );
};

/** The problem under the cursor, or else the first on its line. */
function problemAtCursor(
  diagnostics: readonly FeatureDiagnostic[],
  text: string,
  cursor: number,
): FeatureDiagnostic | null {
  const inCode = diagnostics.filter((diagnostic) => !diagnostic.generatedTag);
  const covering = inCode.find(
    (diagnostic) => diagnostic.from <= cursor && cursor <= diagnostic.to,
  );
  if (covering) return covering;
  const lineStart = text.lastIndexOf("\n", cursor - 1) + 1;
  const newline = text.indexOf("\n", cursor);
  const lineEnd = newline === -1 ? text.length : newline;
  return (
    inCode.find((diagnostic) => diagnostic.from >= lineStart && diagnostic.from <= lineEnd) ?? null
  );
}

/** The status bar's note beside the counts: the problem at the cursor, as Zed shows it. */
const CursorProblem = ({ diagnostic }: { readonly diagnostic: FeatureDiagnostic | null }) => {
  if (!diagnostic) return null;
  const Icon = diagnostic.severity === "error" ? ErrorIcon : WarningIcon;
  const tone = diagnostic.severity === "error" ? "text-error" : "text-canvas-orange";
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={diagnostic.message}>
      <Icon aria-hidden className={cn("size-3.5 shrink-0", tone)} />
      <span className="truncate text-primary">{diagnostic.message}</span>
      {diagnostic.rule ? (
        <span className="shrink-0 text-secondary">(Feanor {diagnostic.rule})</span>
      ) : null}
    </span>
  );
};

const OUTLINE_OPEN_KEY = "shift.featureCodeWindow.outlineOpen";

/** Whether the outline was open when the window last showed it; open by default. */
function readOutlineOpen(): boolean {
  try {
    return localStorage.getItem(OUTLINE_OPEN_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeOutlineOpen(open: boolean): void {
  try {
    localStorage.setItem(OUTLINE_OPEN_KEY, String(open));
  } catch {
    // Remembering the outline is a convenience; private storage may refuse it.
  }
}
