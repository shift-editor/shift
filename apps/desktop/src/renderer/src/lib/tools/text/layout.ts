import type { Point2D, FontMetrics } from "@shift/types";
import type { Bounds } from "@shift/geo";
import type { Font } from "@/lib/editor/Font";
import { GlyphRenderCache } from "@/lib/cache/GlyphRenderCache";
import { isLikelyNonSpacingGlyphRef } from "@/lib/utils/unicode";

const NON_SPACING_EDITOR_ADVANCE = 600;

export interface GlyphRef {
  glyphName: string;
  unicode: number | null;
}

export interface GlyphSlot {
  glyph: GlyphRef;
  unicode: number | null;
  x: number;
  advance: number;
  bounds: Bounds | null;
  svgPath: string | null;
  selected: boolean;
}

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
  let x = origin.x;
  const selected = false;

  for (const glyph of glyphs) {
    const rawAdvance =
      font.getAdvanceByName?.(glyph.glyphName) ??
      (glyph.unicode !== null ? font.getAdvance(glyph.unicode) : null) ??
      0;
    const advance = resolveEditorAdvance(glyph, rawAdvance);
    const bounds =
      font.getBboxByName?.(glyph.glyphName) ??
      (glyph.unicode !== null ? font.getBbox(glyph.unicode) : null);
    const svgPath =
      font.getSvgPathByName?.(glyph.glyphName) ??
      (glyph.unicode !== null ? font.getSvgPath(glyph.unicode) : null);

    slots.push({
      glyph,
      unicode: glyph.unicode,
      x,
      advance,
      bounds,
      svgPath,
      selected,
    });

    x += advance;
  }

  return {
    slots,
    totalAdvance: x - origin.x,
  };
}

function resolveEditorAdvance(glyph: GlyphRef, advance: number): number {
  if (advance > 0) return advance;
  if (!isLikelyNonSpacingGlyphRef(glyph.glyphName, glyph.unicode)) {
    return advance;
  }
  return NON_SPACING_EDITOR_ADVANCE;
}

function isWithinVerticalBounds(pos: Point2D, metrics: FontMetrics): boolean {
  const top = metrics.ascender;
  const bottom = metrics.descender;
  return !(pos.y > top || pos.y < bottom);
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
  const minY = slot.bounds.min.y - padding;
  const maxY = slot.bounds.max.y + padding;

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
  options: TextSlotHitTestOptions = {},
): number | null {
  const { slots } = layout;
  if (slots.length === 0) return null;
  if (!isWithinVerticalBounds(pos, metrics)) return null;

  const outlineRadius = Math.max(options.outlineRadius ?? 0, 0);
  const includeFill = options.includeFill ?? false;
  const requireShape = options.requireShape ?? false;
  const pathHitTester =
    options.pathHitTester === undefined ? getDefaultTextPathHitTester() : options.pathHitTester;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
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

    if (slot.svgPath && pathHitTester) {
      const cacheKey = slot.glyph?.glyphName ?? `unicode:${String(slot.unicode ?? "")}`;
      const path = GlyphRenderCache.get(cacheKey, slot.svgPath);
      const hit = pathHitTester.hitPath(
        path,
        pos.x - slot.x,
        pos.y,
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
 */
export function hitTestTextCaret(
  layout: TextLayout,
  pos: Point2D,
  metrics: FontMetrics,
): number | null {
  const { slots } = layout;
  if (slots.length === 0) return null;
  if (!isWithinVerticalBounds(pos, metrics)) return null;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const midX = slot.x + slot.advance / 2;
    if (pos.x < midX) return i;
  }

  return slots.length;
}
