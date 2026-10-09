import type { Canvas, ScreenCanvas, ScreenProjection } from "../../editor/rendering/Canvas";
import type { Editor } from "../../editor/Editor";
import { LOCK_PATH_DATA, LOCK_VIEW_BOX_SIZE } from "../../editor/rendering/icons/lock";
import { kerningLabelLayout, kerningLabelText } from "./KerningLabel";
import { isGroupSide } from "../../model/Kerning";
import type { KerningPair } from "./RunKerning";

type KerningTheme = Canvas["theme"]["kerning"]["negative"];
type LabelTheme = Canvas["theme"]["spacing"];

/** How a pair is drawn beyond its kern and pill. */
export interface KerningDrawOptions {
  /** Whether the pointer is on the pill, which lightens and shows the groups' reach. */
  readonly hovered?: boolean;
  /** Whether the arrow keys change this pair, which gives its strip a light edge. */
  readonly selected?: boolean;
}

/**
 * Draws a pair's kern and its pill, leaving the glyphs themselves clear.
 *
 * @remarks
 * The kern is a translucent strip between the two advance edges in the
 * kerning colours, which no spacing overlay uses: violet when it tightens or
 * is zero, teal when it loosens, and grey at an interpolated location. The pill below the baseline
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
  const theme = kerningTheme(canvas, editor, pair);
  canvas.withTransform(editor.sceneTransform(pair.gap.node), (local) => {
    if (options.hovered) drawGroupGlyphs(local, editor, pair, theme);
    local.withScreenSpace((screen, project) => {
      drawKern(screen, project, pair, theme, options.selected ?? false);
      drawPill(screen, editor, pair, theme, canvas.theme.spacing, options.hovered ?? false);
    });
  });
}

/**
 * Grey between sources, where the kern is interpolated and read-only; else
 * teal for a loosening kern and violet for a tightening or zero one.
 */
function kerningTheme(canvas: Canvas, editor: Editor, pair: KerningPair): KerningTheme {
  const palettes = canvas.theme.kerning;
  if (!editor.activeSourceId) return palettes.interpolated;
  return pair.amount > 0 ? palettes.positive : palettes.negative;
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
  // Only the selected pair, the one the arrow keys change, has an edge.
  if (!selected) return;
  screen.strokeRect(left + 0.5, top + 0.5, Math.max(width - 1, 0), height - 1, theme.edge, 1);
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
  const members = new Set(
    [edited.first, edited.second]
      .filter(isGroupSide)
      .flatMap((groupId) => kerning.groups.group(groupId)?.glyphIds ?? []),
  );
  if (members.size === 0) return;

  const pairItems = new Set([pair.gap.left.itemId, pair.gap.right.itemId]);
  for (const placed of layout.placedGlyphs) {
    const glyphId = placed.glyph.glyphId;
    const itemId = placed.glyph.sourceItemIds[0];
    if (!glyphId || (itemId && pairItems.has(itemId))) continue;
    if (!members.has(glyphId)) continue;
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
