import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureSubstitution, FontFeature, GlyphId } from "@shift/types";
import type { Editor } from "@shift/editor";
import type { TextRunRecord } from "@shift/editor/text";
import { useSignalState } from "@shift/editor/signals";
import {
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
  feature,
  anchor,
  onClose,
}: {
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
              <FeaturePreview key={feature.tag} tag={feature.tag} />
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

/**
 * Every glyph a feature brings in, drawn in the font, as kerning previews a
 * group's members. Clicking a glyph selects it, for actions on the glyph.
 */
const FeaturePreview = ({ tag }: { readonly tag: string }) => {
  const glyphs = useFeatureGlyphs(tag);
  // Remembers its feature, so previewing another drops the selection.
  const [picked, setPicked] = useState<{ tag: string; glyph: GlyphId } | null>(null);
  const selected = picked !== null && picked.tag === tag ? picked.glyph : null;
  const shown = glyphs.slice(0, MAX_PREVIEW_GLYPHS);

  return (
    <div className="p-2">
      <div className="scrollbar-hidden flex h-32 flex-wrap content-start items-center gap-1.5 overflow-y-auto rounded-md bg-input p-2">
        {shown.length === 0 ? (
          <p className="flex h-full w-full items-center justify-center text-ui text-secondary">
            No glyph changes to show
          </p>
        ) : (
          shown.map(({ glyph }) => (
            <PreviewGlyphButton
              key={glyph}
              glyph={glyph}
              selected={glyph === selected}
              onClick={() => setPicked(glyph === selected ? null : { tag, glyph })}
            />
          ))
        )}
      </div>
    </div>
  );
};

const PreviewGlyphButton = ({
  glyph,
  selected,
  onClick,
}: {
  readonly glyph: GlyphId;
  readonly selected: boolean;
  readonly onClick: () => void;
}) => {
  const editor = useEditor();
  return (
    <button
      type="button"
      aria-label={glyphName(editor, glyph)}
      aria-pressed={selected}
      className={cn(
        "flex rounded p-0.5 outline-none focus-visible:ring-1 focus-visible:ring-accent",
        selected ? "bg-accent/20" : "hover:bg-hover",
      )}
      onClick={onClick}
    >
      <GlyphThumbnail glyphId={glyph} size={PREVIEW_GLYPH_PX} />
    </button>
  );
};

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
