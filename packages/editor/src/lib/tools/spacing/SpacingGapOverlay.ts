import type { Canvas, ScreenCanvas, ScreenProjection } from "../../editor/rendering/Canvas";
import type { Editor } from "../../editor/Editor";
import type { SpacingGap, SpacingSideName } from "../../../types/spacing";
import { spacingLabelRect, spacingLabelText } from "./SpacingLabel";
import type { SpacingHalf } from "./RunSpacing";

/**
 * Draws a spacing gap as two hatched halves meeting at the advance boundary.
 *
 * @remarks
 * The left half is the left glyph's right sidebearing and the right half the
 * right glyph's left sidebearing. They hatch in opposite directions so the
 * boundary reads without a line, and the `active` half, the one a drag would
 * change, is drawn stronger than the other, with its value in a pill in its
 * middle. A negative sidebearing's half covers the overlap past the boundary
 * and takes the negative colours.
 */
export function drawSpacingGap(
  canvas: Canvas,
  editor: Editor,
  active: SpacingHalf,
  options: SpacingGapDrawOptions = {},
): void {
  const { gap } = active;
  const matched = options.matched ? active.other() : null;
  canvas.withTransform(editor.sceneTransform(gap.node), (local) => {
    local.withScreenSpace((screen, project) => {
      for (const side of ["left", "right"] as const) {
        const strong = side === active.side || side === matched?.side;
        drawHalf(screen, project, gap, side, strong, side === options.selected);
      }
      drawLabel(screen, editor, active, {
        hovered: options.labelHovered ?? false,
        ringed: options.snapped ?? false,
      });
      if (matched) drawLabel(screen, editor, matched, { hovered: false, ringed: true });
    });
  });
}

/** How a gap is drawn beyond its active half. */
export interface SpacingGapDrawOptions {
  /** Whether the pointer is over the active half's pill, which then lightens. */
  readonly labelHovered?: boolean;
  /** The half the arrow keys change, which gets an outline. */
  readonly selected?: SpacingSideName | null;
  /** Whether the active half snapped to the gap's other half, which is then drawn strong with a ringed pill. */
  readonly matched?: boolean;
  /** Whether the active value snapped, which rings its pill. */
  readonly snapped?: boolean;
}

function drawHalf(
  screen: ScreenCanvas,
  project: ScreenProjection,
  gap: SpacingGap,
  side: SpacingSideName,
  strong: boolean,
  selected: boolean,
): void {
  const half = gap[side];
  if (!half || half.edge === gap.boundary) return;

  const theme = screen.theme.spacing;
  const a = project.point({ x: half.edge, y: gap.top });
  const b = project.point({ x: gap.boundary, y: gap.bottom });
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  const height = bottom - top;
  const colors = halfColors(theme, strong, half.sidebearing < 0);
  const ctx = screen.ctx;

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, right - left, height);
  ctx.clip();
  ctx.fillStyle = colors.fill;
  ctx.fillRect(left, top, right - left, height);
  ctx.beginPath();
  for (let x = left - height; x < right + height; x += theme.hatchGapPx) {
    if (side === "left") {
      ctx.moveTo(x, bottom);
      ctx.lineTo(x + height, top);
    } else {
      ctx.moveTo(x, top);
      ctx.lineTo(x + height, bottom);
    }
  }
  ctx.strokeStyle = colors.hatch;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  if (selected) {
    screen.strokeRect(left + 0.5, top + 0.5, right - left - 1, height - 1, colors.outline, 1);
  }
}

/** The pill's fill: negative or not, and slightly lighter while hovered to show it opens. */
function labelFill(
  theme: Canvas["theme"]["spacing"],
  isNegative: boolean,
  hovered: boolean,
): string {
  if (isNegative) return hovered ? theme.negativeLabelHoverFill : theme.negativeLabelFill;
  return hovered ? theme.labelHoverFill : theme.labelFill;
}

/** A half's fill and hatch: strong when active, and in the negative colours below zero. */
function halfColors(
  theme: Canvas["theme"]["spacing"],
  isActive: boolean,
  isNegative: boolean,
): { fill: string; hatch: string; outline: string } {
  if (isNegative) {
    const outline = theme.negativeLabelFill;
    return isActive
      ? { fill: theme.negativeActiveFill, hatch: theme.negativeActiveHatch, outline }
      : { fill: theme.negativeIdleFill, hatch: theme.negativeIdleHatch, outline };
  }
  const outline = theme.labelFill;
  return isActive
    ? { fill: theme.activeFill, hatch: theme.activeHatch, outline }
    : { fill: theme.idleFill, hatch: theme.idleHatch, outline };
}

/** Draws a half's sidebearing as a small pill centred in it; a ring marks a snapped value. */
function drawLabel(
  screen: ScreenCanvas,
  editor: Editor,
  half: SpacingHalf,
  { hovered, ringed }: { readonly hovered: boolean; readonly ringed: boolean },
): void {
  const rect = spacingLabelRect(editor, half);
  const text = spacingLabelText(half);
  const glyphSide = half.glyphSide;
  if (!rect || !text || !glyphSide) return;

  const theme = screen.theme.spacing;
  const ctx = screen.ctx;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, rect.height / 2);
  ctx.fillStyle = labelFill(theme, glyphSide.sidebearing < 0, hovered);
  ctx.fill();
  if (ringed) {
    ctx.strokeStyle = theme.labelText;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.font = theme.labelFont;
  ctx.fillStyle = theme.labelText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2);
  ctx.restore();
}
