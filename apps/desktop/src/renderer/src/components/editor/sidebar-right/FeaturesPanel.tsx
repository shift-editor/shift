import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureSubstitution, FontFeature, GlyphId } from "@shift/types";
import type { Editor } from "@shift/editor";
import { characterTextItem, type TextItem, type TextRunRecord } from "@shift/editor/text";
import { useSignalState } from "@shift/editor/signals";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuPortal,
  ContextMenuPositioner,
  ContextMenuTrigger,
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
  Tooltip,
  X,
  cn,
} from "@shift/ui";
import { useEditor } from "@/workspace/WorkspaceContext";
import { GlyphThumbnail } from "../../kerning/groups/GlyphThumbnail";
import { glyphName } from "../../kerning/groups/previewGlyphs";
import { GlyphSelection } from "../../glyph-grid/GlyphSelection";
import { copyGlyphNames } from "../../glyph-grid/glyphNames";
import { useGlyphSelection } from "../../glyph-grid/useGlyphSelection";
import { featureName } from "../featureNames";
import { onByDefault } from "./fontFeatures";
import { sidebarBlock } from "./SidebarPicker";

/** How many of a feature's glyphs the preview draws; a large set shows its first ones. */
const MAX_PREVIEW_GLYPHS = 120;

/** How a feature tag is shown wherever features are listed; callers add its colour. */
export const TAG_PILL = "shrink-0 rounded bg-input px-1.5 py-0.5 font-mono text-ui font-normal";

/** The size of each glyph in the preview, in CSS pixels. */
const PREVIEW_GLYPH_PX = 32;

/**
 * What a feature changes, beside the sidebar: opened by clicking a feature's
 * tag, with the feature's tag and name, the glyphs it brings in, and a close
 * button. Clicking another tag while it is open switches it to that feature.
 */
export function FeaturePreviewPopover({
  run,
  feature,
  anchor,
  onClose,
}: {
  /** The proof text the features apply to, which Insert into Text adds to. */
  readonly run: TextRunRecord;
  /** The feature to preview; null while closed. */
  readonly feature: FontFeature | null;
  /** The tag that opened it; the popover sits beside the Features section holding it. */
  readonly anchor: HTMLElement | null;
  readonly onClose: () => void;
}) {
  const name = feature ? featureName(feature) : null;
  const section = anchor?.closest("section") ?? null;
  // One object per section: the positioner re-anchors only when its anchor changes, not when a function's result does.
  const reference = useMemo(() => besideSection(section), [section]);
  return (
    <Popover
      open={feature !== null}
      onOpenChange={(next, details) => {
        if (next) return;
        // A feature tag switches the open preview to its feature; it does not close it first.
        const target = details.event.target;
        const onTag = target instanceof Element && target.closest("[data-feature-tag]") !== null;
        if (details.reason === "outside-press" && onTag) return;
        onClose();
      }}
      modal={false}
    >
      <PopoverPortal>
        <PopoverPositioner
          anchor={reference}
          side="left"
          align="start"
          // Shift to stay on screen rather than flip, so its top stays level with the section's where it can.
          collisionAvoidance={{ side: "none", align: "shift", fallbackAxisSide: "none" }}
          sideOffset={-1}
          alignOffset={-1}
        >
          {feature ? (
            <PopoverPopup className="flex w-72 flex-col p-0">
              <div className="flex h-8 items-center justify-between gap-1 border-b border-line-subtle pr-1 pl-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={cn(TAG_PILL, "text-primary")}>{feature.tag}</span>
                  <span className="min-w-0 truncate">
                    <PopoverTitle>{name ?? feature.tag}</PopoverTitle>
                  </span>
                </span>
                <CloseButton />
              </div>
              <FeaturePreview key={feature.tag} run={run} tag={feature.tag} />
            </PopoverPopup>
          ) : null}
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
}

/**
 * Returns where the preview sits: against the sidebar block's edge, level
 * with the top of the Features section, so scrolling the feature list or
 * switching features leaves it in place.
 */
function besideSection(
  section: HTMLElement | null,
): { contextElement: Element; getBoundingClientRect(): DOMRect } | null {
  const block = sidebarBlock(section);
  if (!section || !block) return null;
  return {
    // Follows the section when the sidebar itself scrolls.
    contextElement: section,
    getBoundingClientRect: () => {
      const edge = block.getBoundingClientRect();
      const { top, height } = section.getBoundingClientRect();
      return new DOMRect(edge.left, top, edge.width, height);
    },
  };
}

const CloseButton = () => (
  <Tooltip content="Close">
    <PopoverClose variant="icon" aria-label="Close">
      <X className="h-4 w-4" />
    </PopoverClose>
  </Tooltip>
);

/**
 * Highlights, in the run, what a feature changes: its output glyphs while
 * it is on, the glyphs it would replace while it is off. Clears on unmount.
 */
export function useFeatureHighlight(run: TextRunRecord): (tag: string | null) => void {
  const editor = useEditor();
  // non-reactive: the tag being highlighted, so a late answer for an old one is dropped.
  const current = useRef<string | null>(null);
  useEffect(() => () => editor.text.setHighlight(null), [editor]);
  return (tag) => {
    current.current = tag;
    if (tag === null) {
      editor.text.setHighlight(null);
      return;
    }
    const on = run.features[tag] ?? onByDefault(tag);
    void (async () => {
      try {
        const substitutions = await editor.font.featureSubstitutions(tag);
        if (current.current !== tag) return;
        const glyphs = new Set(
          substitutions.flatMap(({ input, output }) => (on ? [output] : input)),
        );
        editor.text.setHighlight({ runId: run.id, glyphs });
      } catch (error) {
        console.error("failed to read a feature's substitutions", error);
      }
    })();
  };
}

/** A glyph a feature puts in the text, and every glyph sequence it replaces. */
interface FeatureGlyph {
  readonly glyph: GlyphId;
  readonly replaces: readonly (readonly GlyphId[])[];
}

const NO_GLYPHS: readonly GlyphId[] = [];

/**
 * Every glyph a feature brings in, drawn in the font, as kerning previews a
 * group's members. Glyphs select as in a group preview: click, Shift-click
 * or drag for a range, ⌘-click to add or remove one, and the arrow keys.
 * The context menu copies the selection's names (also ⌘C) or inserts what
 * it replaces into the text, so the feature shapes it there.
 */
const FeaturePreview = ({ run, tag }: { readonly run: TextRunRecord; readonly tag: string }) => {
  const editor = useEditor();
  const glyphs = useFeatureGlyphs(tag);
  const shown = useMemo(
    () => glyphs.slice(0, MAX_PREVIEW_GLYPHS).map(({ glyph }) => glyph),
    [glyphs],
  );
  const [selection, setSelection] = useState(() => GlyphSelection.empty(NO_GLYPHS));
  const current = selection.withGlyphs(shown);
  const containerRef = useRef<HTMLDivElement>(null);
  const copy = () => void copyGlyphNames(editor, current.ids);
  const insert = () => {
    const replaced = new Map(glyphs.map((entry) => [entry.glyph, entry.replaces[0] ?? []]));
    insertIntoRun(
      editor,
      run,
      inputItems(
        editor,
        current.ids.map((id) => replaced.get(id) ?? []),
      ),
    );
  };
  const select = useGlyphSelection({
    selection: current,
    onSelect: setSelection,
    containerRef,
    glyphAt: (clientX, clientY) => {
      const cell = document.elementFromPoint(clientX, clientY)?.closest("[data-preview-glyph]");
      if (!cell || !containerRef.current?.contains(cell)) return null;
      return shown[Number(cell.getAttribute("data-preview-glyph"))] ?? null;
    },
    onCopy: copy,
  });

  return (
    <div className="p-2">
      {shown.length === 0 ? (
        <p className="flex h-32 items-center justify-center rounded-md bg-input text-ui text-secondary">
          No glyph changes to show
        </p>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger
            className="contents"
            onContextMenu={(event) => {
              // A right-click on a glyph outside the selection acts on that glyph alone.
              const glyph = document
                .elementFromPoint(event.clientX, event.clientY)
                ?.closest("[data-preview-glyph]");
              const id = glyph ? shown[Number(glyph.getAttribute("data-preview-glyph"))] : null;
              if (id && !current.has(id)) setSelection(current.click(id, PLAIN_CLICK));
            }}
          >
            <div
              ref={containerRef}
              tabIndex={0}
              role="listbox"
              aria-multiselectable
              aria-label={`Glyphs ${tag} brings in`}
              className="scrollbar-hidden flex h-32 flex-wrap content-start items-center gap-1.5 overflow-y-auto rounded-md bg-input p-2 outline-none select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
              {...select}
            >
              {shown.map((glyph, index) => (
                <div
                  key={glyph}
                  role="option"
                  aria-label={glyphName(editor, glyph)}
                  aria-selected={current.has(glyph)}
                  data-preview-glyph={index}
                  className={cn(
                    "flex cursor-pointer rounded p-0.5",
                    current.has(glyph) ? "bg-accent/20" : "hover:bg-hover",
                  )}
                >
                  <GlyphThumbnail glyphId={glyph} size={PREVIEW_GLYPH_PX} />
                </div>
              ))}
            </div>
          </ContextMenuTrigger>
          <ContextMenuPortal>
            <ContextMenuPositioner>
              <ContextMenuPopup className="w-auto">
                <ContextMenuItem disabled={current.isEmpty} onClick={copy}>
                  Copy Names
                  <span className="ml-auto pl-3 text-secondary">⌘C</span>
                </ContextMenuItem>
                <ContextMenuItem disabled={current.isEmpty} onClick={insert}>
                  Insert into Text
                </ContextMenuItem>
              </ContextMenuPopup>
            </ContextMenuPositioner>
          </ContextMenuPortal>
        </ContextMenu>
      )}
    </div>
  );
};

const PLAIN_CLICK = { range: false, toggle: false };

/**
 * The items for glyph sequences, a space apart so one sequence's rules do
 * not reach into the next; a glyph the font maps a character to becomes
 * that character, so it shapes like typed text.
 */
function inputItems(editor: Editor, sequences: readonly (readonly GlyphId[])[]): TextItem[] {
  return sequences
    .filter((sequence) => sequence.length > 0)
    .flatMap((sequence, index) => {
      const glyphs = sequence.flatMap((id) => editor.text.glyphItem(id) ?? []);
      return index === 0 ? glyphs : [characterTextItem(SPACE), ...glyphs];
    });
}

const SPACE = 0x20;

/** Inserts items at the caret while typing in the run, otherwise at its end. */
function insertIntoRun(editor: Editor, run: TextRunRecord, items: readonly TextItem[]): void {
  if (items.length === 0) return;
  if (editor.textEditing.state) {
    editor.textEditing.insert(items);
    return;
  }
  editor.history.capture("Insert glyphs", () =>
    editor.text.setItems(run.id, [...run.items, ...items]),
  );
}

/** Each feature's preview glyphs per editor, at the feature code revision they were read at. */
const previewed = new WeakMap<
  Editor,
  { readonly revision: number; readonly byTag: Map<string, readonly FeatureGlyph[]> }
>();

/**
 * The glyphs a feature brings in, with what each replaces, loaded so they
 * draw. Starts from the last answer for that feature at the same feature
 * code, and keeps the last answer while the next loads, so neither opening
 * the preview nor switching features flashes empty.
 */
function useFeatureGlyphs(tag: string | null): readonly FeatureGlyph[] {
  const editor = useEditor();
  const featureRevision = useSignalState(editor.font.featureRevisionCell);
  const cache = previewed.get(editor);
  const cached = tag && cache?.revision === featureRevision ? cache.byTag.get(tag) : undefined;
  const [glyphs, setGlyphs] = useState<readonly FeatureGlyph[]>(cached ?? []);
  useEffect(() => {
    if (!tag || editor.sessionMode !== "workspace") {
      setGlyphs([]);
      return;
    }
    const known = previewed.get(editor);
    const hit = known?.revision === featureRevision ? known.byTag.get(tag) : undefined;
    if (hit) {
      setGlyphs(hit);
      return;
    }
    let current = true;
    void (async () => {
      try {
        const byOutput = groupByOutput(await editor.font.featureSubstitutions(tag));
        await editor.font.loadGlyphs(
          byOutput.slice(0, MAX_PREVIEW_GLYPHS).map((entry) => entry.glyph),
        );
        const entry = previewed.get(editor);
        if (entry?.revision === featureRevision) entry.byTag.set(tag, byOutput);
        else
          previewed.set(editor, { revision: featureRevision, byTag: new Map([[tag, byOutput]]) });
        if (current) setGlyphs(byOutput);
      } catch (error) {
        console.error("failed to read a feature's substitutions", error);
      }
    })();
    return () => {
      current = false;
    };
  }, [editor, tag, featureRevision]);
  return glyphs;
}

/** One entry per output glyph, in the substitutions' order. */
function groupByOutput(substitutions: readonly FeatureSubstitution[]): FeatureGlyph[] {
  const replaced = new Map<GlyphId, GlyphId[][]>();
  for (const { input, output } of substitutions) {
    const inputs = replaced.get(output) ?? [];
    inputs.push([...input]);
    replaced.set(output, inputs);
  }
  return [...replaced].map(([glyph, replaces]) => ({ glyph, replaces }));
}
