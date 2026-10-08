import { asGlyphId, type KerningSide } from "@shift/types";
import type { Canvas, ScreenCanvas, ScreenProjection } from "../../editor/rendering/Canvas";
import type { Editor } from "../../editor/Editor";
import type { Rect2D } from "@shift/geo";
import {
  kerningLabelLayout,
  kerningLabelText,
  type KerningLabelLayout,
  type KerningLabelTarget,
} from "./KerningLabel";
import type { KerningPair } from "./RunKerning";

type SpacingTheme = Canvas["theme"]["spacing"];

/** How a pair is drawn beyond its kern and pill. */
export interface KerningDrawOptions {
  /** The part of the pill under the pointer, which lightens to show it responds. */
  readonly hovered?: KerningLabelTarget | null;
  /** Whether the arrow keys change this pair, which outlines its kern. */
  readonly selected?: boolean;
}

/**
 * Draws a pair's kern, the glyphs its groups reach, and its pill.
 *
 * @remarks
 * The kern spans the two advance boundaries, filled in the spacing colours,
 * or the negative ones when it tightens. Other glyphs in the run that kern
 * through one of the pair's groups are filled in the kerning colour, so the
 * reach of a group edit shows before it is made. The pill holds a lock for each side
 * (closed: the glyph itself is kerned; open: its group is) and the value.
 */
export function drawKerningPair(
  canvas: Canvas,
  editor: Editor,
  pair: KerningPair,
  options: KerningDrawOptions = {},
): void {
  const { gap } = pair;
  const theme = canvas.theme.spacing;
  canvas.withTransform(editor.sceneTransform(gap.node), (local) => {
    drawGroupGlyphs(local, editor, pair, theme);
    local.withScreenSpace((screen, project) => {
      drawKern(screen, project, pair, theme, options.selected ?? false);
      drawPill(screen, editor, pair, theme, options.hovered ?? null);
    });
  });
}

function drawKern(
  screen: ScreenCanvas,
  project: ScreenProjection,
  pair: KerningPair,
  theme: SpacingTheme,
  selected: boolean,
): void {
  const { gap } = pair;
  const negative = pair.amount < 0;
  const a = project.point({ x: gap.leftBoundary, y: gap.top });
  const b = project.point({ x: gap.rightBoundary, y: gap.bottom });
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const height = Math.max(a.y, b.y) - top;
  const edge = negative ? theme.negativeActiveHatch : theme.activeHatch;
  const selectedEdge = negative ? theme.negativeLabelFill : theme.labelFill;

  const ctx = screen.ctx;
  ctx.save();
  ctx.fillStyle = negative ? theme.negativeActiveFill : theme.activeFill;
  ctx.fillRect(left, top, right - left, height);
  // A selected pair, the one the arrow keys change, has heavier edges.
  ctx.strokeStyle = selected ? selectedEdge : edge;
  ctx.lineWidth = selected ? 2 : 1;
  ctx.beginPath();
  for (const x of right - left < 1 ? [left] : [left, right]) {
    ctx.moveTo(Math.round(x) + 0.5, top);
    ctx.lineTo(Math.round(x) + 0.5, top + height);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Fills, over their glyph fill, the other glyphs of the run that kern
 * through a group of the edited pair at the active source.
 */
function drawGroupGlyphs(
  local: Canvas,
  editor: Editor,
  pair: KerningPair,
  theme: SpacingTheme,
): void {
  const edited = pair.editablePair(editor);
  const layout = editor.text.layoutCell(pair.gap.node.runId).peek();
  if (!edited || !layout) return;

  const kerning = editor.font.kerningCell.peek();
  const groups: Array<readonly ["first" | "second", string]> = [];
  if (edited.first.kind === "group") groups.push(["first", edited.first.id]);
  if (edited.second.kind === "group") groups.push(["second", edited.second.id]);
  if (groups.length === 0) return;

  const pairItems = new Set([pair.gap.left.itemId, pair.gap.right.itemId]);
  for (const placed of layout.placedGlyphs) {
    const glyphId = placed.glyph.glyphId;
    const itemId = placed.glyph.sourceItemIds[0];
    if (!glyphId || (itemId && pairItems.has(itemId))) continue;
    if (!groups.some(([position, group]) => kerning.groupOf(position, glyphId) === group)) {
      continue;
    }
    const model = editor
      .glyphForId(glyphId)
      ?.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell);
    if (!model) continue;

    local.save();
    local.translate(placed.origin.x, placed.origin.y);
    local.fillPath(model.drawPath, theme.labelFill);
    local.restore();
  }
}

function drawPill(
  screen: ScreenCanvas,
  editor: Editor,
  pair: KerningPair,
  theme: SpacingTheme,
  hovered: KerningLabelTarget | null,
): void {
  const layout = kerningLabelLayout(editor, pair);
  const { pill, amount } = layout;
  const negative = pair.amount < 0;
  const fill = negative ? theme.negativeLabelFill : theme.labelFill;
  const hoverFill = negative ? theme.negativeLabelHoverFill : theme.labelHoverFill;

  const ctx = screen.ctx;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(pill.x, pill.y, pill.width, pill.height, pill.height / 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (hovered) {
    const rect = labelPart(layout, hovered);
    ctx.fillStyle = hoverFill;
    ctx.beginPath();
    ctx.roundRect(rect.x - 1, pill.y + 1, rect.width + 2, pill.height - 2, (pill.height - 2) / 2);
    ctx.fill();
  }

  ctx.font = theme.labelFont;
  ctx.fillStyle = theme.labelText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(kerningLabelText(pair), amount.x + amount.width / 2, amount.y + amount.height / 2);

  for (const position of ["first", "second"] as const) {
    const lock = pair.lock(editor, position);
    const rect = position === "first" ? layout.firstLock : layout.secondLock;
    ctx.globalAlpha = lock.toggleable ? 1 : 0.45;
    drawLock(ctx, rect.x + rect.width / 2, rect.y + rect.height / 2, lock.locked, theme.labelText);
    ctx.globalAlpha = 1;
  }

  const edited = pair.editablePair(editor);
  if (edited) {
    ctx.fillStyle = fill;
    ctx.textBaseline = "top";
    ctx.fillText(
      `${sideLabel(editor, edited.first)}  ${sideLabel(editor, edited.second)}`,
      pill.x + pill.width / 2,
      pill.y + pill.height + 4,
    );
  }
  ctx.restore();
}

/** The rectangle of one part of a pair's pill. */
function labelPart(layout: KerningLabelLayout, target: KerningLabelTarget): Rect2D {
  switch (target) {
    case "amount":
      return layout.amount;
    case "first":
      return layout.firstLock;
    case "second":
      return layout.secondLock;
  }
}

/** A side as the pill names it: a glyph's name, or a group's with `@`. */
function sideLabel(editor: Editor, side: KerningSide): string {
  if (side.kind === "group") return `@${side.id}`;
  return editor.font.entryForId(asGlyphId(side.id))?.name ?? side.id;
}

/** A 9 px padlock centred at (x, y); an open lock lifts its shackle to one side. */
function drawLock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  locked: boolean,
  color: string,
): void {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.fillRect(-3.5, -0.5, 7, 5);
  ctx.beginPath();
  if (locked) {
    ctx.moveTo(-2, -0.5);
    ctx.lineTo(-2, -2.5);
    ctx.arc(0, -2.5, 2, Math.PI, 0);
    ctx.lineTo(2, -0.5);
  } else {
    ctx.moveTo(-2, -0.5);
    ctx.lineTo(-2, -3);
    ctx.arc(0, -3, 2, Math.PI, 0);
    ctx.lineTo(2, -2);
  }
  ctx.stroke();
  ctx.restore();
}
