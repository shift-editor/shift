import type { Canvas, ScreenCanvas, ScreenProjection } from "../../editor/rendering/Canvas";
import type { Editor } from "../../editor/Editor";
import { LOCK_PATH_DATA, LOCK_VIEW_BOX_SIZE } from "../../editor/rendering/icons/lock";
import { kerningLabelLayout, kerningLabelText } from "./KerningLabel";
import type { KerningPair } from "./RunKerning";

type SpacingTheme = Canvas["theme"]["spacing"];

/** How a pair is drawn beyond its kern and pill. */
export interface KerningDrawOptions {
  /** Whether the pointer is on the pill, which lightens and shows the groups' reach. */
  readonly hovered?: boolean;
  /** Whether the arrow keys change this pair, which outlines its zone. */
  readonly selected?: boolean;
}

/**
 * Draws a pair's kern and its pill, leaving the glyphs themselves clear.
 *
 * @remarks
 * The kern is a hatched zone below the baseline between the two advance
 * edges, like a spacing half, in the negative colours when it tightens. The
 * pill in the zone shows the value, with a lock on a side that is a glyph
 * exception. While the pointer is on the pill, other
 * glyphs of the run that kern through one of the pair's groups fill in the
 * kerning colour, showing the reach of a group edit.
 */
export function drawKerningPair(
  canvas: Canvas,
  editor: Editor,
  pair: KerningPair,
  options: KerningDrawOptions = {},
): void {
  const theme = canvas.theme.spacing;
  canvas.withTransform(editor.sceneTransform(pair.gap.node), (local) => {
    if (options.hovered) drawGroupGlyphs(local, editor, pair, theme);
    local.withScreenSpace((screen, project) => {
      drawKern(screen, project, pair, theme, options.selected ?? false);
      drawPill(screen, editor, pair, theme, options.hovered ?? false);
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
  const a = project.point({ x: gap.leftBoundary, y: gap.baseline });
  const b = project.point({ x: gap.rightBoundary, y: gap.bottom });
  const left = Math.min(a.x, b.x);
  const width = Math.max(Math.abs(b.x - a.x), 1);
  const top = Math.min(a.y, b.y);
  const height = Math.abs(b.y - a.y);
  const fill = negative ? theme.negativeActiveFill : theme.activeFill;
  const hatch = negative ? theme.negativeActiveHatch : theme.activeHatch;
  const outline = negative ? theme.negativeLabelFill : theme.labelFill;

  const ctx = screen.ctx;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  ctx.fillStyle = fill;
  ctx.fillRect(left, top, width, height);
  ctx.beginPath();
  for (let x = left - height; x < left + width + height; x += theme.hatchGapPx) {
    ctx.moveTo(x, top + height);
    ctx.lineTo(x + height, top);
  }
  ctx.strokeStyle = hatch;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  if (selected) screen.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1, outline, 1);
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
  hovered: boolean,
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
  ctx.fillStyle = hovered ? hoverFill : fill;
  ctx.fill();

  ctx.font = theme.labelFont;
  ctx.fillStyle = theme.labelText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(kerningLabelText(pair), amount.x + amount.width / 2, amount.y + amount.height / 2);
  for (const { rect } of layout.locks) {
    drawLock(ctx, rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width, theme.labelText);
  }
  ctx.restore();
}

let lockPath: Path2D | null = null;

/** Draws the editor's lock icon, the one locked guides use, filling `size` px centred at (x, y). */
function drawLock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  lockPath ??= new Path2D(LOCK_PATH_DATA);
  const scale = size / LOCK_VIEW_BOX_SIZE;
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.fill(lockPath);
  ctx.restore();
}
