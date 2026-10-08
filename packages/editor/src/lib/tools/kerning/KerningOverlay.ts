import type { Canvas, ScreenCanvas, ScreenProjection } from "../../editor/rendering/Canvas";
import type { Editor } from "../../editor/Editor";
import { LOCK_PATH_DATA, LOCK_VIEW_BOX_SIZE } from "../../editor/rendering/icons/lock";
import { kerningLabelLayout, kerningLabelText } from "./KerningLabel";
import type { KerningPair } from "./RunKerning";

type KerningTheme = Canvas["theme"]["kerning"]["negative"];
type LabelTheme = Canvas["theme"]["spacing"];

/** How a pair is drawn beyond its kern and pill. */
export interface KerningDrawOptions {
  /** Whether the pointer is on the pill, which lightens and shows the groups' reach. */
  readonly hovered?: boolean;
  /** Whether the arrow keys change this pair, which gives its strip a heavier, full-strength edge. */
  readonly selected?: boolean;
}

/**
 * Draws a pair's kern and its pill, leaving the glyphs themselves clear.
 *
 * @remarks
 * The kern is a translucent strip between the two advance edges in the
 * kerning colours, which no spacing overlay uses: violet when it tightens or
 * is zero, teal when it loosens. The pill below the baseline
 * shows the value, with a lock on a side that is a glyph exception. While the pointer is on the pill, other
 * glyphs of the run that kern through one of the pair's groups fill in the
 * kerning colour, showing the reach of a group edit.
 */
export function drawKerningPair(
  canvas: Canvas,
  editor: Editor,
  pair: KerningPair,
  options: KerningDrawOptions = {},
): void {
  // A loosening kern takes its own colour; zero and tightening share violet.
  const theme = pair.amount > 0 ? canvas.theme.kerning.positive : canvas.theme.kerning.negative;
  canvas.withTransform(editor.sceneTransform(pair.gap.node), (local) => {
    if (options.hovered) drawGroupGlyphs(local, editor, pair, theme);
    local.withScreenSpace((screen, project) => {
      drawKern(screen, project, pair, theme, options.selected ?? false);
      drawPill(screen, editor, pair, theme, canvas.theme.spacing, options.hovered ?? false);
    });
  });
}

function drawKern(
  screen: ScreenCanvas,
  project: ScreenProjection,
  pair: KerningPair,
  theme: KerningTheme,
  selected: boolean,
): void {
  const { gap } = pair;
  const a = project.point({ x: gap.leftBoundary, y: gap.top });
  const b = project.point({ x: gap.rightBoundary, y: gap.bottom });
  const left = Math.min(a.x, b.x);
  const width = Math.max(Math.abs(b.x - a.x), 1);
  const top = Math.min(a.y, b.y);
  const height = Math.abs(b.y - a.y);

  screen.fillRect(left, top, width, height, theme.fill);
  // A light edge while hovered; the selected pair's edge is full strength and heavier.
  const edge = selected ? 2 : 1;
  screen.strokeRect(
    left + edge / 2,
    top + edge / 2,
    Math.max(width - edge, 0),
    height - edge,
    selected ? theme.accent : theme.edge,
    edge,
  );
}

/**
 * Fills, over their glyph fill, the other glyphs of the run that kern
 * through a group of the edited pair at the active source.
 */
function drawGroupGlyphs(
  local: Canvas,
  editor: Editor,
  pair: KerningPair,
  theme: KerningTheme,
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
    local.fillPath(model.drawPath, theme.accent);
    local.restore();
  }
}

function drawPill(
  screen: ScreenCanvas,
  editor: Editor,
  pair: KerningPair,
  theme: KerningTheme,
  label: LabelTheme,
  hovered: boolean,
): void {
  const layout = kerningLabelLayout(editor, pair);
  const { pill, amount } = layout;

  const ctx = screen.ctx;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(pill.x, pill.y, pill.width, pill.height, pill.height / 2);
  ctx.fillStyle = hovered ? theme.accentHover : theme.accent;
  ctx.fill();

  ctx.font = label.labelFont;
  ctx.fillStyle = label.labelText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(kerningLabelText(pair), amount.x + amount.width / 2, amount.y + amount.height / 2);
  for (const { rect } of layout.locks) {
    drawLock(ctx, rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width, label.labelText);
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
