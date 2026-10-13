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
import type { FeatureDiagnostic } from "@shift/types";
import { cn } from "@shift/ui";
import { getShiftHost } from "@/host/shiftHost";
import { useEditor, useFontSession } from "@/workspace/WorkspaceContext";
import { featureName } from "../featureNames";
import { feaHighlighting } from "./feaHighlighting";
import { featureCodeTheme } from "./featureCodeTheme";
import { featureDiagnostics, showFeatureDiagnostics } from "./featureDiagnostics";
import { FeatureCodeSync } from "./FeatureCodeSync";
import { featureFolding } from "./featureFolding";
import { enclosingEntries, featureOutline, type OutlineEntry } from "./featureOutline";

interface FeatureCodePanelProps {
  /** Receives the code editor once it exists, so the window can run menu commands in it. */
  readonly onView: (view: EditorView | null) => void;
}

/**
 * The font's feature code in the feature code window: a grouped outline, the
 * code, and a status bar. Typing applies the code after a pause.
 */
export const FeatureCodePanel = ({ onView }: FeatureCodePanelProps) => {
  const editor = useEditor();
  const familyName = useSignalState(useFontSession().catalog.familyNameCell) ?? "Untitled";
  const isMac = getShiftHost().platform === "darwin";
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [loaded, setLoaded] = useState<LoadedFeatureCode | null>(null);
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [problems, setProblems] = useState<readonly FeatureDiagnostic[]>([]);
  const syncRef = useRef<FeatureCodeSync | null>(null);
  const featureRevision = useSignalState(editor.font.featureRevisionCell);

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
          featureCodeTheme,
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap]),
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
    syncRef.current = new FeatureCodeSync(view, editor, loaded.source, setProblems);
    setText(loaded.source);
    setProblems(loaded.diagnostics);
    showFeatureDiagnostics(view, loaded.diagnostics);
    return () => {
      syncRef.current?.dispose();
      syncRef.current = null;
      view.destroy();
      viewRef.current = null;
      onView(null);
    };
  }, [editor, loaded, onView]);

  useEffect(() => {
    void syncRef.current?.refresh();
  }, [featureRevision]);

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
          "titlebar-drag grid h-9 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-line-subtle select-none",
          isMac ? "pl-20" : "pl-3.5",
        )}
      >
        <span />
        <p className="truncate px-4 text-ui whitespace-nowrap">
          <span className="font-medium">Feature Code</span>
          <span className="text-muted"> — {familyName}</span>
        </p>
        <span />
      </header>
      <div className="flex min-h-0 flex-1">
        <Outline entries={outline} path={path} onJump={jump} />
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
        </div>
      </div>
      <footer className="flex h-7 shrink-0 items-center gap-3.5 border-t border-line-subtle px-3 text-ui text-secondary">
        <ProblemCount diagnostics={problems} />
        <span className="flex-1" />
        <span>
          Ln {position.line}, Col {position.column}
        </span>
        <span>FEA</span>
      </footer>
    </section>
  );
};

/** The font's feature code and the compiler's problems with it, read together. */
interface LoadedFeatureCode {
  readonly source: string;
  readonly diagnostics: readonly FeatureDiagnostic[];
}

interface OutlineProps {
  readonly entries: readonly OutlineEntry[];
  /** The entries the cursor is inside, outermost first. */
  readonly path: readonly OutlineEntry[];
  readonly onJump: (entry: OutlineEntry) => void;
}

/** Features with their lookups, then standalone lookups, classes, and setup; filtered by the search field. */
const Outline = ({ entries, path, onJump }: OutlineProps) => {
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
      <OutlineGroup title="Features" show={features.length > 0}>
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

/** The status bar's count of problems: red for errors, quiet when the code compiles. */
const ProblemCount = ({ diagnostics }: { readonly diagnostics: readonly FeatureDiagnostic[] }) => {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  if (errors === 0 && warnings === 0) return <span>No problems</span>;
  return (
    <span className="flex items-center gap-3">
      {errors > 0 ? (
        <span className="flex items-center gap-1.5 text-error">
          <span aria-hidden className="size-1.5 rounded-full bg-error" />
          {errors === 1 ? "1 error" : `${errors} errors`}
        </span>
      ) : null}
      {warnings > 0 ? <span>{warnings === 1 ? "1 warning" : `${warnings} warnings`}</span> : null}
      {errors > 0 ? <span>Proof text uses the last good build</span> : null}
    </span>
  );
};
