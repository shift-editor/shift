import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@shift/editor";
import type { KerningPairPosition } from "@shift/editor/model";
import { effect, track, useSignalState } from "@shift/editor/signals";
import type { GlyphEntry, GlyphId, KerningGroupId } from "@shift/types";
import {
  Button,
  Check,
  ChevronDown,
  Input,
  Plus,
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
  PopoverTrigger,
  Search,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  X,
} from "@shift/ui";
import { GroupsIcon } from "@/components/icons/GroupsIcon";
import { TrashIcon } from "@/components/icons/TrashIcon";
import { SidebarActionButton } from "@/components/sidebar";
import { useEditor } from "@/workspace/WorkspaceContext";
import {
  NO_MEMBERS_SELECTED,
  clickSelection,
  dragSelection,
  retainMembers,
  selectAllMembers,
  stepSelection,
  type MemberSelection,
} from "./memberSelection";

/** The glyph edge a pair position kerns through: a first glyph's right edge, a second's left. */
const EDGE_LABEL: Readonly<Record<KerningPairPosition, string>> = {
  first: "right edge",
  second: "left edge",
};

const GROUP_LIST_TITLE: Readonly<Record<KerningPairPosition, string>> = {
  first: "Right groups",
  second: "Left groups",
};

const EDGE_TABS: ReadonlyArray<{ position: KerningPairPosition; label: string }> = [
  { position: "first", label: "Right" },
  { position: "second", label: "Left" },
];

/**
 * What the panel opens on: a selected pair, whose groups are set against
 * each other in the preview, or one glyph, both of whose edges are shown
 * with nothing to kern them against.
 */
export type KerningGroupsTarget =
  | { readonly kind: "pair"; readonly first: GlyphId; readonly second: GlyphId }
  | { readonly kind: "glyph"; readonly glyphId: GlyphId };

/** The target's glyph at a pair position, whose group a tab opens on. */
function targetGlyph(target: KerningGroupsTarget, position: KerningPairPosition): GlyphId {
  if (target.kind === "glyph") return target.glyphId;
  return position === "first" ? target.first : target.second;
}

/** The glyph a tab's preview sets the members against: the pair's other glyph, if any. */
function targetPartner(target: KerningGroupsTarget, position: KerningPairPosition): GlyphId | null {
  if (target.kind === "glyph") return null;
  return position === "first" ? target.second : target.first;
}

interface KerningGroupsPanelProps {
  readonly target: KerningGroupsTarget;
  /** The sidebar block the panel opens beside, flush with its left edge and top. */
  readonly anchorRef: React.RefObject<HTMLElement | null>;
}

/**
 * The font's kerning groups, in a panel flush with the sidebar, opening on
 * the target's groups: right-edge or left-edge groups, the one shown (any
 * can be picked), its members (set against a pair's other glyph at the
 * current kern), and the members to add to or remove from.
 */
export function KerningGroupsPanel({ target, anchorRef }: KerningGroupsPanelProps) {
  const targetKey =
    target.kind === "pair" ? `${target.first}:${target.second}` : `glyph:${target.glyphId}`;
  const [position, setPosition] = useState<KerningPairPosition>("first");

  return (
    <Popover modal={false}>
      <Tooltip>
        <TooltipTrigger>
          <PopoverTrigger
            render={
              <SidebarActionButton label="Kerning groups">
                <GroupsIcon aria-hidden className="h-4 w-4" />
              </SidebarActionButton>
            }
          />
        </TooltipTrigger>
        <TooltipContent>Kerning groups</TooltipContent>
      </Tooltip>
      <PopoverPortal>
        {/* Its right border on the sidebar's border, its top on the divider above the anchor. */}
        <PopoverPositioner
          anchor={anchorRef}
          side="left"
          align="start"
          sideOffset={-1}
          alignOffset={-1}
        >
          <PopoverPopup className="relative flex w-72 flex-col p-0">
            <div className="flex h-8 items-center justify-between border-b border-line-subtle px-2">
              <PopoverTitle>Kerning groups</PopoverTitle>
              <Tooltip>
                <TooltipTrigger>
                  <PopoverClose variant="icon" aria-label="Close">
                    <X className="h-4 w-4" />
                  </PopoverClose>
                </TooltipTrigger>
                <TooltipContent>Close</TooltipContent>
              </Tooltip>
            </div>
            <Tabs
              value={position}
              onValueChange={(value) => setPosition(value as KerningPairPosition)}
            >
              <div className="border-b border-line-subtle px-2 py-1.5">
                <TabsList variant="pill">
                  {EDGE_TABS.map((tab) => (
                    <TabsTab key={tab.position} value={tab.position} variant="pill">
                      {tab.label}
                    </TabsTab>
                  ))}
                </TabsList>
              </div>
              {EDGE_TABS.map((tab) => (
                <TabsPanel key={tab.position} value={tab.position}>
                  <GroupView
                    key={targetKey}
                    position={tab.position}
                    glyphId={targetGlyph(target, tab.position)}
                    otherGlyphId={targetPartner(target, tab.position)}
                  />
                </TabsPanel>
              ))}
            </Tabs>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
}

interface GroupViewProps {
  readonly position: KerningPairPosition;
  /** The glyph on this side, whose group is shown first. */
  readonly glyphId: GlyphId;
  /** The pair's other glyph, which the preview sets the members against; null without a pair. */
  readonly otherGlyphId: GlyphId | null;
}

/** A group at one pair position: the glyph's own until another is picked. */
function GroupView({ position, glyphId, otherGlyphId }: GroupViewProps) {
  const editor = useEditor();
  const kerning = useSignalState(editor.font.kerningCell);
  const own = kerning.groupOf(position, glyphId);
  const [picked, setPicked] = useState<KerningGroupId | null>(null);
  const [sidePanel, setSidePanel] = useState<"groups" | "add" | null>(null);
  const [hovered, setHovered] = useState<GlyphId | null>(null);
  const [selection, setSelection] = useState<MemberSelection>(NO_MEMBERS_SELECTED);
  const shownId = picked !== null && kerning.groups.group(picked) ? picked : own;
  const shownGroup = shownId ? kerning.groups.group(shownId) : null;
  // The shown group's name, which the panel labels it with.
  const shown = shownGroup?.name ?? null;
  const members = shownGroup?.glyphIds ?? [];
  // A member removed or moved elsewhere is no longer selected.
  const current = retainMembers(selection, members);
  const selected = current.ids;
  const removeSelected = () => void editor.font.assignKerningGroup(position, selected, null);

  // A press anywhere but the preview and its selection row, in or out of the
  // panel, dismisses the member selection.
  const hasSelection = selected.length > 0;
  useEffect(() => {
    if (!hasSelection) return undefined;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-keeps-member-selection]")
      ) {
        return;
      }
      setSelection(NO_MEMBERS_SELECTED);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [hasSelection]);

  const addButton = shown ? (
    <Tooltip>
      <TooltipTrigger>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0"
          isActive={sidePanel === "add"}
          aria-label={`Add glyphs to ${shown}`}
          aria-expanded={sidePanel === "add"}
          onClick={() => setSidePanel(sidePanel === "add" ? null : "add")}
        >
          <Plus className="h-4.5 w-4.5" strokeWidth={1.75} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Add glyphs</TooltipContent>
    </Tooltip>
  ) : null;

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="field"
          size="field"
          isActive={sidePanel === "groups"}
          aria-label={`Kerning group shown, ${EDGE_LABEL[position]}`}
          aria-expanded={sidePanel === "groups"}
          onClick={() => setSidePanel(sidePanel === "groups" ? null : "groups")}
        >
          <span className={shown ? "truncate" : "truncate text-muted"}>{shown ?? "No group"}</span>
          <span className="flex shrink-0 items-center gap-1.5 text-muted">
            {shown ? <span className="tabular-nums">{members.length}</span> : null}
            <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
          </span>
        </Button>
        {addButton}
      </div>
      {sidePanel === "groups" ? (
        <GroupsSidePanel
          position={position}
          shown={shownId}
          onPick={(group) => {
            setPicked(group);
            setSelection(NO_MEMBERS_SELECTED);
            setSidePanel(null);
          }}
          onClose={() => setSidePanel(null)}
        />
      ) : null}
      {shown ? (
        <>
          <GroupPreview
            position={position}
            group={shown}
            members={members}
            otherGlyphId={otherGlyphId}
            hovered={hovered}
            selection={current}
            onHover={setHovered}
            onSelect={setSelection}
            onRemove={removeSelected}
          />
          {selected.length > 0 ? (
            <div
              data-keeps-member-selection=""
              className="flex h-6 items-center justify-between gap-2 pl-1"
            >
              <span className="truncate text-ui text-primary">
                {selected.length === 1 && selected[0]
                  ? glyphName(editor, selected[0])
                  : `${selected.length} glyphs selected`}
              </span>
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${selected.length === 1 ? "glyph" : `${selected.length} glyphs`} from ${shown}`}
                    onClick={removeSelected}
                  >
                    <TrashIcon aria-hidden className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remove from group</TooltipContent>
              </Tooltip>
            </div>
          ) : null}
          {sidePanel === "add" && shownId ? (
            <AddMembersPanel
              position={position}
              groupId={shownId}
              groupName={shown}
              members={members}
              onClose={() => setSidePanel(null)}
            />
          ) : null}
        </>
      ) : (
        <p className="px-1 text-ui text-muted">
          {glyphName(editor, glyphId)}'s {EDGE_LABEL[position]} has no group. Pick one above to look
          at it, or put {glyphName(editor, glyphId)} in one from the sidebar.
        </p>
      )}
    </div>
  );
}

/** The preview's type size, in CSS pixels per em. */
const PREVIEW_EM_PX = 28;
const PREVIEW_LINE_EM = 1.5;
/** Where the baseline sits below a line's top, leaving room for accents. */
const PREVIEW_BASELINE_EM = 1.1;
const PREVIEW_WORD_GAP_EM = 0.4;
/** How strongly the glyph the members kern against is drawn, next to the members. */
const OTHER_GLYPH_ALPHA = 0.4;
/** How close to the preview's top or bottom a drag starts scrolling it, in CSS pixels. */
const AUTOSCROLL_EDGE_PX = 12;
/** Scroll speed per pixel the pointer is past that edge, per frame, up to a maximum. */
const AUTOSCROLL_RATE = 0.4;
const AUTOSCROLL_MAX_PX = 16;

interface GroupPreviewProps {
  readonly position: KerningPairPosition;
  readonly group: string;
  readonly members: readonly GlyphId[];
  readonly otherGlyphId: GlyphId | null;
  readonly hovered: GlyphId | null;
  readonly selection: MemberSelection;
  readonly onHover: (member: GlyphId | null) => void;
  readonly onSelect: (selection: MemberSelection) => void;
  /** Takes the selected members out of the group. */
  readonly onRemove: () => void;
}

/**
 * Every member set against the pair's other glyph, kerned as the font kerns
 * at the active source or location, so a member whose edge does not match
 * shows as a collision or a gap. It is also the member list: click to
 * select, Shift-click or drag for a range, ⌘-click to add or remove one;
 * the arrow keys move (Shift extends), ⌘A selects all, and Delete takes the
 * selection out of the group.
 */
function GroupPreview({
  position,
  group,
  members,
  otherGlyphId,
  hovered,
  selection,
  onHover,
  onSelect,
  onRemove,
}: GroupPreviewProps) {
  const editor = useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // non-reactive: the last drawn layout, read only by pointer handlers.
  const wordsRef = useRef<readonly PreviewWord[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  // non-reactive: the member a drag started on, while the pointer is down.
  const dragAnchorRef = useRef<GlyphId | null>(null);
  // non-reactive: the dragging pointer in client pixels, for the autoscroll frame.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  // The autoscroll frame outlives renders, so it reads the latest props through refs.
  const membersRef = useRef(members);
  membersRef.current = members;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const glyphIds = otherGlyphId ? [otherGlyphId, ...members] : members;
    editor.font.loadGlyphs(glyphIds).catch((error: unknown) => {
      console.error("failed to load kerning group preview glyphs", error);
    });
  }, [editor, members, otherGlyphId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const subscription = effect(() => {
      wordsRef.current = drawPreview(canvas, editor, position, members, otherGlyphId, {
        hovered,
        selected: selection.ids,
      });
    });
    return () => subscription.dispose();
  }, [editor, hovered, members, otherGlyphId, position, selection.ids]);

  const memberAt = (clientX: number, clientY: number): GlyphId | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const line = Math.floor(y / (PREVIEW_LINE_EM * PREVIEW_EM_PX));
    const word = wordsRef.current.find(
      (candidate) =>
        candidate.line === line &&
        x >= candidate.cellX &&
        x < candidate.cellX + candidate.cellWidth,
    );
    return word?.memberId ?? null;
  };

  // While a drag holds the pointer past the visible rows, scroll toward it
  // each frame and extend the selection to the member at the nearest edge.
  const scrollDrag = () => {
    const container = containerRef.current;
    const pointer = pointerRef.current;
    const anchor = dragAnchorRef.current;
    if (!container || !pointer || !anchor) return;
    const bounds = container.getBoundingClientRect();
    const above = bounds.top + AUTOSCROLL_EDGE_PX - pointer.y;
    const below = pointer.y - (bounds.bottom - AUTOSCROLL_EDGE_PX);
    const reach = Math.max(above, below);
    if (reach > 0) {
      const speed = Math.min(reach * AUTOSCROLL_RATE, AUTOSCROLL_MAX_PX);
      container.scrollTop += above > 0 ? -speed : speed;
      const y = Math.min(Math.max(pointer.y, bounds.top + 1), bounds.bottom - 1);
      const member = memberAt(pointer.x, y);
      if (member) onSelectRef.current(dragSelection(membersRef.current, anchor, member));
    }
    scrollFrameRef.current = requestAnimationFrame(scrollDrag);
  };

  const endDrag = () => {
    dragAnchorRef.current = null;
    pointerRef.current = null;
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = null;
  };

  useEffect(() => endDrag, []);

  return (
    <div
      data-keeps-member-selection=""
      ref={containerRef}
      tabIndex={0}
      role="group"
      aria-label={`Members of ${group}`}
      className="scrollbar-hidden max-h-44 overflow-y-auto rounded bg-input p-1 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
      onKeyDown={(event) => {
        const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
        const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
        if (forward || backward) {
          onSelect(stepSelection(members, selection, forward ? 1 : -1, event.shiftKey));
        } else if (event.key === "a" && (event.metaKey || event.ctrlKey)) {
          onSelect(selectAllMembers(members));
        } else if ((event.key === "Delete" || event.key === "Backspace") && selection.ids.length) {
          onRemove();
        } else if (event.key === "Escape" && selection.ids.length) {
          onSelect(NO_MEMBERS_SELECTED);
        } else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        title={hovered ? glyphName(editor, hovered) : undefined}
        className="block w-full cursor-pointer select-none text-primary"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const member = memberAt(event.clientX, event.clientY);
          const modifiers = { range: event.shiftKey, toggle: event.metaKey || event.ctrlKey };
          const next = clickSelection(members, selection, member, modifiers);
          onSelect(next);
          // A drag from a plain press sweeps a range from where it started.
          dragAnchorRef.current = member && !modifiers.range && !modifiers.toggle ? member : null;
          if (!dragAnchorRef.current) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointerRef.current = { x: event.clientX, y: event.clientY };
          scrollFrameRef.current = requestAnimationFrame(scrollDrag);
        }}
        onPointerMove={(event) => {
          const member = memberAt(event.clientX, event.clientY);
          onHover(member);
          const anchor = dragAnchorRef.current;
          if (!anchor) return;
          pointerRef.current = { x: event.clientX, y: event.clientY };
          if (member) onSelect(dragSelection(members, anchor, member));
        }}
        onPointerUp={endDrag}
        onLostPointerCapture={endDrag}
        onPointerLeave={() => onHover(null)}
      />
    </div>
  );
}

interface PreviewGlyph {
  readonly path: Path2D;
  readonly advance: number;
}

interface PreviewWord {
  readonly memberId: GlyphId;
  /** The word's cell: one column of an even grid, so pairs line up in columns. */
  readonly cellX: number;
  readonly cellWidth: number;
  readonly line: number;
  /** Where the word's first glyph starts, centring the word in its cell. */
  readonly x: number;
  readonly member: PreviewGlyph;
  readonly kern: number;
}

/** The members drawn marked: the one under the pointer and the selected ones. */
interface PreviewMarks {
  readonly hovered: GlyphId | null;
  readonly selected: readonly GlyphId[];
}

/** How strongly a marked pair's box is filled, in the text colour or the accent. */
const HOVER_BOX_ALPHA = 0.06;
const SELECTED_BOX_ALPHA = 0.18;

/**
 * Draws each member beside the other glyph as wrapped words, the other glyph
 * dimmed and marked members boxed. Reads its signals, so an effect around it
 * redraws on any change.
 *
 * @returns The words as drawn, for hit testing.
 */
function drawPreview(
  canvas: HTMLCanvasElement,
  editor: Editor,
  position: KerningPairPosition,
  members: readonly GlyphId[],
  otherGlyphId: GlyphId | null,
  marks: PreviewMarks,
): readonly PreviewWord[] {
  track(editor.font.kerningCell);
  track(editor.externalLocationCell);
  track(editor.activeSourceIdCell);
  track(editor.font.metricsCell);

  const scale = PREVIEW_EM_PX / editor.font.metricsCell.peek().unitsPerEm;
  const location = editor.externalLocationCell.peek();
  const sourceId = editor.activeSourceIdCell.peek();
  // Without a partner each word is the member alone, unkerned.
  const other = otherGlyphId ? previewGlyph(editor, otherGlyphId) : null;
  const waitingForPartner = otherGlyphId !== null && other === null;
  const width = canvas.clientWidth;
  const gap = PREVIEW_WORD_GAP_EM * PREVIEW_EM_PX;

  const measured: Array<{ memberId: GlyphId; member: PreviewGlyph; kern: number; width: number }> =
    [];
  for (const memberId of waitingForPartner ? [] : members) {
    const member = previewGlyph(editor, memberId);
    if (!member) continue;
    const kern =
      other && otherGlyphId
        ? editor.font.kerningBetween(
            position === "first" ? memberId : otherGlyphId,
            position === "first" ? otherGlyphId : memberId,
            location,
            sourceId,
          )
        : 0;
    const width = member.advance + (other ? kern + other.advance : 0);
    measured.push({ memberId, member, kern, width: width * scale });
  }

  // Even columns as wide as the widest word plus a gap, spread to fill the width.
  const widest = Math.max(0, ...measured.map((word) => word.width));
  const columns = Math.max(1, Math.floor(width / (widest + gap)));
  const cellWidth = width / columns;
  const words: PreviewWord[] = measured.map((word, index) => {
    const cellX = (index % columns) * cellWidth;
    return {
      memberId: word.memberId,
      cellX,
      cellWidth,
      line: Math.floor(index / columns),
      x: cellX + (cellWidth - word.width) / 2,
      member: word.member,
      kern: word.kern,
    };
  });

  const lineHeight = PREVIEW_LINE_EM * PREVIEW_EM_PX;
  const lines = Math.max(1, Math.ceil(words.length / columns));
  const height = lines * lineHeight;
  const ratio = window.devicePixelRatio || 1;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);

  const ctx = canvas.getContext("2d");
  if (!ctx) return words;
  const style = getComputedStyle(canvas);
  const accent = style.getPropertyValue("--color-accent").trim() || style.color;
  for (const word of words) {
    const selectedWord = marks.selected.includes(word.memberId);
    if (!selectedWord && word.memberId !== marks.hovered) continue;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.globalAlpha = selectedWord ? SELECTED_BOX_ALPHA : HOVER_BOX_ALPHA;
    ctx.fillStyle = selectedWord ? accent : style.color;
    ctx.beginPath();
    ctx.roundRect(
      word.cellX + 1,
      word.line * lineHeight + 1,
      word.cellWidth - 2,
      lineHeight - 2,
      4,
    );
    ctx.fill();
  }
  ctx.fillStyle = style.color;
  for (const word of words) {
    const baseline = word.line * lineHeight + PREVIEW_BASELINE_EM * PREVIEW_EM_PX;
    if (!other) {
      fillGlyph(ctx, word.member.path, word.x, baseline, scale, ratio, 1);
      continue;
    }
    const [first, second] = position === "first" ? [word.member, other] : [other, word.member];
    const secondX = word.x + (first.advance + word.kern) * scale;
    fillGlyph(
      ctx,
      first.path,
      word.x,
      baseline,
      scale,
      ratio,
      first === other ? OTHER_GLYPH_ALPHA : 1,
    );
    fillGlyph(
      ctx,
      second.path,
      secondX,
      baseline,
      scale,
      ratio,
      second === other ? OTHER_GLYPH_ALPHA : 1,
    );
  }
  return words;
}

/** The thumbnail's square size, in CSS pixels. */
const THUMBNAIL_PX = 22;

/** A glyph's outline at the active source or location, fitted into a small square. */
function GlyphThumbnail({ glyphId }: { readonly glyphId: GlyphId }) {
  const editor = useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const subscription = effect(() => drawThumbnail(canvas, editor, glyphId));
    return () => subscription.dispose();
  }, [editor, glyphId]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      width={THUMBNAIL_PX}
      height={THUMBNAIL_PX}
      className="size-5.5 shrink-0 text-primary"
    />
  );
}

/** Draws one glyph centred on its advance, baseline at a fixed height; reruns on its signals. */
function drawThumbnail(canvas: HTMLCanvasElement, editor: Editor, glyphId: GlyphId): void {
  track(editor.font.metricsCell);
  const glyph = previewGlyph(editor, glyphId);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(THUMBNAIL_PX * ratio);
  canvas.height = Math.round(THUMBNAIL_PX * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx || !glyph) return;

  const scale = (THUMBNAIL_PX * 0.75) / editor.font.metricsCell.peek().unitsPerEm;
  const x = (THUMBNAIL_PX - glyph.advance * scale) / 2;
  const baseline = THUMBNAIL_PX * 0.78;
  ctx.fillStyle = getComputedStyle(canvas).color;
  fillGlyph(ctx, glyph.path, x, baseline, scale, ratio, 1);
}

function previewGlyph(editor: Editor, glyphId: GlyphId): PreviewGlyph | null {
  const model = editor
    .glyphForId(glyphId)
    ?.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell);
  if (!model) return null;
  track(model.svgPathCell);
  track(model.xAdvanceCell);
  return { path: model.drawPath, advance: model.xAdvance };
}

function fillGlyph(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  x: number,
  baseline: number,
  scale: number,
  ratio: number,
  alpha: number,
): void {
  ctx.setTransform(scale * ratio, 0, 0, -scale * ratio, x * ratio, baseline * ratio);
  ctx.globalAlpha = alpha;
  ctx.fill(path);
}

interface SidePanelProps {
  readonly title: string;
  /** What the search field searches, for its label and placeholder. */
  readonly searchLabel: string;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}

/**
 * A searchable list beside the groups panel's left side, its top level with
 * the panel's: a title and a search field, each above a rule, then the list.
 *
 * @remarks
 * Part of the groups panel rather than a popover of its own, so the two
 * line up exactly and clicks in it never count as outside the panel.
 */
function SidePanel({
  title,
  searchLabel,
  query,
  onQueryChange,
  onClose,
  children,
}: SidePanelProps) {
  return (
    <section
      aria-label={title}
      className="absolute -top-px right-full flex w-60 flex-col rounded-md border border-line-subtle bg-surface shadow-lg"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="flex h-8 items-center justify-between border-b border-line-subtle px-2">
        <h2 className="truncate text-ui font-medium text-primary">{title}</h2>
        <Tooltip>
          <TooltipTrigger>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </div>
      <div className="border-b border-line-subtle p-2">
        <Input
          autoFocus
          aria-label={searchLabel}
          icon={<Search className="h-3 w-3 text-muted" />}
          iconPosition="left"
          placeholder={searchLabel}
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
      </div>
      <div className="scrollbar-hidden max-h-72 overflow-y-auto p-1">{children}</div>
    </section>
  );
}

interface GroupsSidePanelProps {
  readonly position: KerningPairPosition;
  /** The group the panel shows now, ticked in the list. */
  readonly shown: KerningGroupId | null;
  readonly onPick: (groupId: KerningGroupId) => void;
  readonly onClose: () => void;
}

/** The groups at one pair position with their member counts; picking one shows it. */
function GroupsSidePanel({ position, shown, onPick, onClose }: GroupsSidePanelProps) {
  const editor = useEditor();
  const kerning = useSignalState(editor.font.kerningCell);
  const [query, setQuery] = useState("");
  const typed = query.trim().toLowerCase();
  const groups = kerning.groups
    .atPosition(position)
    .filter((group) => !typed || group.name.toLowerCase().includes(typed));

  return (
    <SidePanel
      title={GROUP_LIST_TITLE[position]}
      searchLabel="Search groups"
      query={query}
      onQueryChange={setQuery}
      onClose={onClose}
    >
      <ul>
        {groups.map((group) => (
          <li key={group.id}>
            <Button
              type="button"
              variant="row"
              isActive={group.id === shown}
              className="h-7 justify-between"
              onClick={() => onPick(group.id)}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="flex w-3 shrink-0 justify-center">
                  {group.id === shown ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="truncate">{group.name}</span>
              </span>
              <span className="shrink-0 text-ui text-muted tabular-nums">
                {group.glyphIds.length}
              </span>
            </Button>
          </li>
        ))}
      </ul>
      {groups.length === 0 ? <p className="px-2 py-1 text-ui text-muted">No groups</p> : null}
    </SidePanel>
  );
}

/** How many matching glyphs the search lists; large fonts have tens of thousands. */
const ADD_MEMBER_LIMIT = 50;

interface AddMembersPanelProps {
  readonly position: KerningPairPosition;
  readonly groupId: KerningGroupId;
  readonly groupName: string;
  readonly members: readonly GlyphId[];
  readonly onClose: () => void;
}

/**
 * A glyph search beside the groups panel. Each glyph picked joins the group,
 * leaving its old one, and the search stays open to add more.
 */
function AddMembersPanel({ position, groupId, groupName, members, onClose }: AddMembersPanelProps) {
  const editor = useEditor();
  const entries = useSignalState(editor.font.glyphEntriesCell);
  const kerning = useSignalState(editor.font.kerningCell);
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const candidates = useMemo(() => {
    const inGroup = new Set(members);
    const outside = entries.filter((entry) => !inGroup.has(entry.id));
    if (typed) {
      const lower = typed.toLowerCase();
      return outside
        .filter(
          (entry) => entry.name.toLowerCase().includes(lower) || glyphCharacter(entry) === typed,
        )
        .slice(0, ADD_MEMBER_LIMIT);
    }
    return suggestedMembers(outside, memberStem(editor, members), (entry) =>
      kerning.groupOf(position, entry.id),
    );
  }, [editor, entries, kerning, members, position, typed]);

  useEffect(() => {
    editor.font.loadGlyphs(candidates.map((entry) => entry.id)).catch((error: unknown) => {
      console.error("failed to load glyphs to add", error);
    });
  }, [candidates, editor]);

  return (
    <SidePanel
      title={`Add to ${groupName}`}
      searchLabel="Search glyphs"
      query={query}
      onQueryChange={setQuery}
      onClose={onClose}
    >
      {!typed && candidates.length > 0 ? (
        <p className="px-2 py-1 text-ui text-muted">Suggested</p>
      ) : null}
      <ul>
        {candidates.map((entry) => (
          <li key={entry.id}>
            <Button
              type="button"
              variant="row"
              className="h-8"
              onClick={() => void editor.font.assignKerningGroup(position, [entry.id], groupId)}
            >
              <GlyphThumbnail glyphId={entry.id} />
              <span className="truncate">{entry.name}</span>
            </Button>
          </li>
        ))}
      </ul>
      {typed && candidates.length === 0 ? (
        <p className="px-2 py-1 text-ui text-muted">No matching glyphs</p>
      ) : null}
    </SidePanel>
  );
}

/**
 * The name the group's members share before any suffix, from its shortest
 * member: `T` for T, T.ss01 and Tcaron.
 */
function memberStem(editor: Editor, members: readonly GlyphId[]): string | null {
  let stem: string | null = null;
  for (const glyphId of members) {
    const base = glyphName(editor, glyphId).split(".")[0] ?? "";
    if (base && (stem === null || base.length < stem.length)) stem = base;
  }
  return stem;
}

/**
 * Glyphs likely to belong with the members: those named after the shared
 * stem, the ones in no group at this position first.
 */
function suggestedMembers(
  outside: readonly GlyphEntry[],
  stem: string | null,
  groupOf: (entry: GlyphEntry) => string | null,
): GlyphEntry[] {
  if (!stem) return [];
  const named = outside.filter((entry) => entry.name.startsWith(stem));
  const ungrouped = named.filter((entry) => groupOf(entry) === null);
  const grouped = named.filter((entry) => groupOf(entry) !== null);
  return [...ungrouped, ...grouped].slice(0, ADD_MEMBER_LIMIT);
}

function glyphName(editor: Editor, glyphId: GlyphId): string {
  return editor.font.entryForId(glyphId)?.name ?? glyphId;
}

/** The glyph's first character, or an empty string for an unencoded glyph. */
function glyphCharacter(entry: GlyphEntry): string {
  const unicode = entry.unicodes[0];
  return unicode === undefined ? "" : String.fromCodePoint(unicode);
}
