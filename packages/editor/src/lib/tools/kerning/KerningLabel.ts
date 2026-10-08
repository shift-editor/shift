import { Rect, type Rect2D } from "@shift/geo";
import type { Editor } from "../../editor/Editor";
import { localPoint } from "../../editor/spaces";
import type { KerningPairPosition } from "../../model/Kerning";
import type { ScreenPoint } from "../../../types/coordinates";
import type { KerningPair } from "./RunKerning";

const HEIGHT_PX = 16;
const PADDING_PX = 4;
/** Width of one character of the label font; the pill sizes from it, so drawing and hits agree. */
const CHARACTER_WIDTH_PX = 6;
/** Width of each side's lock, inside the pill's padding. */
const LOCK_PX = 12;

/** A pair's pill and the parts of it that respond to clicks, in screen pixels. */
export interface KerningLabelLayout {
  readonly pill: Rect2D;
  /** The kern's value, which opens for typing. */
  readonly amount: Rect2D;
  readonly firstLock: Rect2D;
  readonly secondLock: Rect2D;
}

/** What a screen point is over on a pair's pill. */
export type KerningLabelTarget = "amount" | KerningPairPosition;

/** The text a pair's pill shows: its kern in whole units. */
export function kerningLabelText(pair: KerningPair): string {
  return String(Math.round(pair.amount));
}

/**
 * Lays out a pair's pill centred in its gap: the first side's lock, the
 * value, and the second side's lock.
 */
export function kerningLabelLayout(editor: Editor, pair: KerningPair): KerningLabelLayout {
  const { gap } = pair;
  const middle = localPoint(pair.center, (gap.top + gap.bottom) / 2);
  const center = editor.sceneToScreen(editor.toScene(gap.node, middle));

  const valueWidth = kerningLabelText(pair).length * CHARACTER_WIDTH_PX + PADDING_PX * 2;
  const width = valueWidth + (LOCK_PX + PADDING_PX) * 2;
  const x = Math.round(center.x - width / 2);
  const y = Math.round(center.y - HEIGHT_PX / 2);
  const lockY = y + (HEIGHT_PX - LOCK_PX) / 2;
  return {
    pill: Rect.fromXYWH(x, y, width, HEIGHT_PX),
    amount: Rect.fromXYWH(x + PADDING_PX + LOCK_PX, y, valueWidth, HEIGHT_PX),
    firstLock: Rect.fromXYWH(x + PADDING_PX, lockY, LOCK_PX, LOCK_PX),
    secondLock: Rect.fromXYWH(x + width - PADDING_PX - LOCK_PX, lockY, LOCK_PX, LOCK_PX),
  };
}

/** What part of a pair's pill a screen point is over, or null when it is off the pill. */
export function kerningLabelTarget(
  editor: Editor,
  pair: KerningPair,
  point: ScreenPoint,
): KerningLabelTarget | null {
  const layout = kerningLabelLayout(editor, pair);
  if (!Rect.containsPoint(layout.pill, point)) return null;
  if (point.x < layout.amount.x) return "first";
  if (point.x >= layout.amount.x + layout.amount.width) return "second";
  return "amount";
}
