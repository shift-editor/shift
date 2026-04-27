import type { Point2D, FontMetrics } from "@shift/types";
import type { Bounds } from "@shift/geo";
import type { Font } from "@/lib/model/Font";
import { displayAdvance } from "@/lib/utils/unicode";

export interface GlyphRef {
  glyphName: string;
  unicode: number | null;
}

export interface GlyphSlot {
  glyph: GlyphRef;
  unicode: number | null;
  x: number;
  y: number;
  advance: number;
  bounds: Bounds | null;
}

const NEWLINE_GLYPH_NAME = ".newline";

export interface TextLayout {
  slots: GlyphSlot[];
  totalAdvance: number;
}

export interface TextPathHitTester {
  hitPath(path: Path2D, x: number, y: number, strokeWidth: number, includeFill: boolean): boolean;
}

export interface TextSlotHitTestOptions {
  /** Outline hit radius in UPM units. */
  outlineRadius?: number;
  /** Include interior fill in addition to outline stroke checks. */
  includeFill?: boolean;
  /**
   * When true, require an actual glyph shape hit. If false, can fall back to
   * slot-box hit when shape data or a hit tester is unavailable.
   */
  requireShape?: boolean;
  /** Optional override for tests or custom hit-testing backends. */
  pathHitTester?: TextPathHitTester | null;
}

class CanvasTextPathHitTester implements TextPathHitTester {
  #ctx: CanvasRenderingContext2D | null;

  constructor(ctx: CanvasRenderingContext2D | null) {
    this.#ctx = ctx;
  }

  hitPath(path: Path2D, x: number, y: number, strokeWidth: number, includeFill: boolean): boolean {
    if (!this.#ctx) return false;

    this.#ctx.save();
    this.#ctx.lineWidth = Math.max(strokeWidth, Number.EPSILON);
    const onStroke = this.#ctx.isPointInStroke(path, x, y);
    const onFill = includeFill && this.#ctx.isPointInPath(path, x, y);
    this.#ctx.restore();

    return onStroke || onFill;
  }
}

let defaultTextPathHitTester: TextPathHitTester | null | undefined;

function getDefaultTextPathHitTester(): TextPathHitTester | null {
  if (defaultTextPathHitTester !== undefined) {
    return defaultTextPathHitTester;
  }
  if (typeof document === "undefined") {
    defaultTextPathHitTester = null;
    return defaultTextPathHitTester;
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  defaultTextPathHitTester = new CanvasTextPathHitTester(ctx);
  return defaultTextPathHitTester;
}

export function computeTextLayout(glyphs: GlyphRef[], origin: Point2D, font: Font): TextLayout {
  const slots: GlyphSlot[] = [];
  const metrics = font.getMetrics();
  const lineHeight = metrics.ascender - metrics.descender + (metrics.lineGap ?? 0);
  let x = origin.x;
  let y = 0;

  for (const ref of glyphs) {
    if (ref.glyphName === NEWLINE_GLYPH_NAME || ref.unicode === 10) {
      slots.push({ glyph: ref, unicode: 10, x, y, advance: 0, bounds: null });
      x = origin.x;
      y -= lineHeight;
      continue;
    }

    const glyph = font.glyph(ref.glyphName);
    const rawAdvance = glyph?.advance ?? 0;
    const advance = resolveEditorAdvance(ref, rawAdvance);

    slots.push({
      glyph: ref,
      unicode: ref.unicode,
      x,
      y,
      advance,
      bounds: font.getBbox(ref.glyphName) ?? null,
    });

    x += advance;
  }

  return {
    slots,
    totalAdvance: x - origin.x,
  };
}

export { NEWLINE_GLYPH_NAME };

function resolveEditorAdvance(glyph: GlyphRef, advance: number): number {
  return displayAdvance(advance, glyph.glyphName, glyph.unicode);
}

function isWithinSlotVerticalBounds(
  slot: GlyphSlot,
  y: number,
  metrics: FontMetrics,
  padding: number,
): boolean {
  const top = slot.y + metrics.ascender + padding;
  const bottom = slot.y + metrics.descender - padding;
  return y <= top && y >= bottom;
}

function isWithinSlotAdvance(
  slot: GlyphSlot,
  index: number,
  totalSlots: number,
  x: number,
  padding: number,
): boolean {
  const effectiveAdvance = Math.max(slot.advance, 0);
  const startX = slot.x - padding;
  const endX = slot.x + effectiveAdvance + padding;
  const isLastSlot = index === totalSlots - 1;

  if (effectiveAdvance <= 0) {
    return Math.abs(x - slot.x) <= padding;
  }

  if (isLastSlot) {
    return x >= startX && x <= endX;
  }

  return x >= startX && x < endX;
}

function isWithinSlotGlyphBounds(slot: GlyphSlot, pos: Point2D, padding: number): boolean {
  if (!slot.bounds) return true;

  const minX = slot.x + slot.bounds.min.x - padding;
  const maxX = slot.x + slot.bounds.max.x + padding;
  const minY = slot.y + slot.bounds.min.y - padding;
  const maxY = slot.y + slot.bounds.max.y + padding;

  return pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY;
}

function isWithinSlotBoundsX(slot: GlyphSlot, x: number, padding: number): boolean {
  if (!slot.bounds) return false;

  const minX = slot.x + slot.bounds.min.x - padding;
  const maxX = slot.x + slot.bounds.max.x + padding;
  return x >= minX && x <= maxX;
}

/**
 * Returns the glyph slot under the pointer, or null when outside slot bounds.
 * Uses staged filtering:
 * 1) slot advance box
 * 2) glyph bbox (if available)
 * 3) optional glyph-shape hit test (stroke and/or fill)
 */
export function hitTestTextSlot(
  layout: TextLayout,
  pos: Point2D,
  metrics: FontMetrics,
  font: Font,
  options: TextSlotHitTestOptions = {},
): number | null {
  const { slots } = layout;
  if (slots.length === 0) return null;

  const outlineRadius = Math.max(options.outlineRadius ?? 0, 0);
  const includeFill = options.includeFill ?? false;
  const requireShape = options.requireShape ?? false;
  const pathHitTester =
    options.pathHitTester === undefined ? getDefaultTextPathHitTester() : options.pathHitTester;

  for (const [i, slot] of slots.entries()) {
    if (!isWithinSlotVerticalBounds(slot, pos.y, metrics, outlineRadius)) continue;

    const withinAdvance = isWithinSlotAdvance(slot, i, slots.length, pos.x, outlineRadius);

    if (requireShape && slot.bounds) {
      const withinBoundsX = isWithinSlotBoundsX(slot, pos.x, outlineRadius);
      if (!withinAdvance && !withinBoundsX) {
        continue;
      }
    } else if (!withinAdvance) {
      continue;
    }

    if (!isWithinSlotGlyphBounds(slot, pos, outlineRadius)) {
      continue;
    }

    const slotPath = font.getPath(slot.glyph.glyphName);
    if (slotPath && pathHitTester) {
      const hit = pathHitTester.hitPath(
        slotPath,
        pos.x - slot.x,
        pos.y - slot.y,
        Math.max(outlineRadius * 2, Number.EPSILON),
        includeFill,
      );
      if (hit) return i;
      continue;
    }

    if (!requireShape) {
      return i;
    }
  }

  return null;
}

/**
 * Returns caret insertion index using midpoint partitioning.
 * Can return `layout.slots.length` when after the final slot midpoint.
 *
 * For multi-line layouts, finds the closest line by Y distance
 * and partitions only among slots on that line.
 */
export function hitTestTextCaret(
  layout: TextLayout,
  pos: Point2D,
  metrics: FontMetrics,
): number | null {
  const { slots } = layout;
  if (slots.length === 0) return null;

  const lineY = findClosestLineY(slots, pos.y, metrics);
  if (lineY === null) return null;

  // Check the click is within reasonable vertical distance of the line
  const lineHeight = metrics.ascender - metrics.descender;
  const top = lineY + metrics.ascender;
  const bottom = lineY + metrics.descender;
  if (pos.y > top + lineHeight / 2 || pos.y < bottom - lineHeight / 2) return null;

  // Midpoint partitioning among slots on this line only
  for (const [i, slot] of slots.entries()) {
    if (slot.y !== lineY) continue;

    const midX = slot.x + slot.advance / 2;
    if (pos.x < midX) return i;
  }

  // After the last slot on this line
  for (let i = slots.length - 1; i >= 0; i--) {
    if (slots[i].y === lineY) return i + 1;
  }

  return slots.length;
}

function findClosestLineY(slots: GlyphSlot[], y: number, metrics: FontMetrics): number | null {
  let bestY: number | null = null;
  let bestDist = Infinity;

  for (const slot of slots) {
    const lineCenter = slot.y + (metrics.ascender + metrics.descender) / 2;
    const dist = Math.abs(y - lineCenter);
    if (dist < bestDist) {
      bestDist = dist;
      bestY = slot.y;
    }
  }

  return bestY;
}
