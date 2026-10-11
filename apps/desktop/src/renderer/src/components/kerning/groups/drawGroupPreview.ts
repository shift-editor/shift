import type { Editor } from "@shift/editor";
import type { KerningPairPosition } from "@shift/editor/model";
import { track } from "@shift/editor/signals";
import type { GlyphId } from "@shift/types";
import type { MemberSelection } from "./MemberSelection";
import { PreviewLayout, type PreviewWord } from "./PreviewLayout";
import { fillGlyph, previewGlyph, type PreviewGlyph } from "./previewGlyphs";

/** The preview's type size, in CSS pixels per em. */
const PREVIEW_EM_PX = 28;
const PREVIEW_LINE_EM = 1.5;
/** Where the baseline sits below a line's top, leaving room for accents. */
const PREVIEW_BASELINE_EM = 1.1;
const PREVIEW_WORD_GAP_EM = 0.4;
/** How strongly the glyph the members kern against is drawn, next to the members. */
const OTHER_GLYPH_ALPHA = 0.4;
/** How strongly a marked pair's box is filled, in the text colour or the accent. */
const HOVER_BOX_ALPHA = 0.06;
const SELECTED_BOX_ALPHA = 0.18;

/** A member set against the pair's other glyph, kerned. */
export interface MemberWord extends PreviewWord {
  readonly member: PreviewGlyph;
  readonly kern: number;
}

/** What the preview shows: the group's members at one pair position, set against `other`. */
export interface GroupPreviewContent {
  readonly position: KerningPairPosition;
  readonly members: readonly GlyphId[];
  /** The pair's other glyph; null shows each member alone, unkerned. */
  readonly other: GlyphId | null;
}

/** The members drawn marked: the one under the pointer and the selected ones. */
export interface PreviewMarks {
  readonly hovered: GlyphId | null;
  readonly selection: MemberSelection;
}

/**
 * Draws each member beside the other glyph as wrapped words, the other glyph
 * dimmed and marked members boxed. Reads its signals, so an effect around it
 * redraws on any change.
 *
 * @returns The layout as drawn, for hit testing.
 */
export function drawGroupPreview(
  canvas: HTMLCanvasElement,
  editor: Editor,
  content: GroupPreviewContent,
  marks: PreviewMarks,
): PreviewLayout<MemberWord> {
  track(editor.font.kerningCell);
  track(editor.externalLocationCell);
  track(editor.activeSourceIdCell);
  track(editor.font.metricsCell);

  const scale = PREVIEW_EM_PX / editor.font.metricsCell.peek().unitsPerEm;
  const other = content.other ? previewGlyph(editor, content.other) : null;
  const waitingForOther = content.other !== null && other === null;
  const words = waitingForOther ? [] : measureWords(editor, content, other, scale);
  const width = canvas.clientWidth;
  const layout = PreviewLayout.of(
    words,
    width,
    PREVIEW_WORD_GAP_EM * PREVIEW_EM_PX,
    PREVIEW_LINE_EM * PREVIEW_EM_PX,
  );

  const ratio = window.devicePixelRatio || 1;
  canvas.style.height = `${layout.height}px`;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(layout.height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return layout;

  const style = getComputedStyle(canvas);
  const accent = style.getPropertyValue("--color-accent").trim() || style.color;
  for (const cell of layout.cells) {
    const selected = marks.selection.has(cell.word.memberId);
    if (!selected && cell.word.memberId !== marks.hovered) continue;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.globalAlpha = selected ? SELECTED_BOX_ALPHA : HOVER_BOX_ALPHA;
    ctx.fillStyle = selected ? accent : style.color;
    ctx.beginPath();
    ctx.roundRect(
      cell.cellX + 1,
      cell.line * layout.lineHeight + 1,
      cell.cellWidth - 2,
      layout.lineHeight - 2,
      4,
    );
    ctx.fill();
  }

  ctx.fillStyle = style.color;
  for (const cell of layout.cells) {
    const baseline = cell.line * layout.lineHeight + PREVIEW_BASELINE_EM * PREVIEW_EM_PX;
    const { member, kern } = cell.word;
    if (!other) {
      fillGlyph(ctx, member.path, cell.x, baseline, scale, ratio, 1);
      continue;
    }
    const [first, second] = content.position === "first" ? [member, other] : [other, member];
    const secondX = cell.x + (first.advance + kern) * scale;
    const alpha = (glyph: PreviewGlyph) => (glyph === other ? OTHER_GLYPH_ALPHA : 1);
    fillGlyph(ctx, first.path, cell.x, baseline, scale, ratio, alpha(first));
    fillGlyph(ctx, second.path, secondX, baseline, scale, ratio, alpha(second));
  }
  return layout;
}

/** Each loaded member's word, kerned against `other` at the active source or location. */
function measureWords(
  editor: Editor,
  content: GroupPreviewContent,
  other: PreviewGlyph | null,
  scale: number,
): MemberWord[] {
  const location = editor.externalLocationCell.peek();
  const sourceId = editor.activeSourceIdCell.peek();
  const kernOf = (memberId: GlyphId): number => {
    if (!other || content.other === null) return 0;
    const [first, second] =
      content.position === "first" ? [memberId, content.other] : [content.other, memberId];
    return editor.font.kerningBetween(first, second, location, sourceId);
  };

  const words: MemberWord[] = [];
  for (const memberId of content.members) {
    const member = previewGlyph(editor, memberId);
    if (!member) continue;
    const kern = kernOf(memberId);
    const advance = member.advance + (other ? kern + other.advance : 0);
    words.push({ memberId, member, kern, width: advance * scale });
  }
  return words;
}
