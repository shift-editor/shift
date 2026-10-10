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
/** Width of an exception's lock, inside the pill's padding. */
const LOCK_PX = 10;

/** A pair's pill and its parts, in screen pixels. */
export interface KerningLabelLayout {
  readonly pill: Rect2D;
  /** The kern's value, which opens for typing. */
  readonly amount: Rect2D;
  /** A lock for each side that is a glyph exception; absent for a side kerned through its group. */
  readonly locks: ReadonlyArray<{ readonly position: KerningPairPosition; readonly rect: Rect2D }>;
}

/** The text a pair's pill shows: its kern in whole units. */
export function kerningLabelText(pair: KerningPair): string {
  return String(Math.round(pair.amount));
}

/** The sides of the edited pair that are glyph exceptions. */
export function exceptionSides(editor: Editor, pair: KerningPair): KerningPairPosition[] {
  return (["first", "second"] as const).filter((position) => {
    const lock = pair.lock(editor, position);
    return lock.locked && lock.toggleable;
  });
}

/**
 * Lays out a pair's pill centred in the kern's zone below the baseline: the
 * value, with a lock before or after it for an exception side.
 */
export function kerningLabelLayout(editor: Editor, pair: KerningPair): KerningLabelLayout {
  const { gap } = pair;
  const middle = localPoint(pair.center, (gap.baseline + gap.bottom) / 2);
  const center = editor.sceneToScreen(editor.toScene(gap.node, middle));
  const exceptions = exceptionSides(editor, pair);

  const amountWidth = kerningLabelText(pair).length * CHARACTER_WIDTH_PX + PADDING_PX * 2;
  const width = amountWidth + exceptions.length * LOCK_PX;
  const x = Math.round(center.x - width / 2);
  const y = Math.round(center.y - HEIGHT_PX / 2);
  const lockY = y + (HEIGHT_PX - LOCK_PX) / 2;
  const firstLock = exceptions.includes("first");
  const amountX = x + (firstLock ? LOCK_PX : 0);

  return {
    pill: Rect.fromXYWH(x, y, width, HEIGHT_PX),
    amount: Rect.fromXYWH(amountX, y, amountWidth, HEIGHT_PX),
    locks: exceptions.map((position) => ({
      position,
      rect: Rect.fromXYWH(
        position === "first" ? x + PADDING_PX / 2 : amountX + amountWidth - PADDING_PX / 2,
        lockY,
        LOCK_PX,
        LOCK_PX,
      ),
    })),
  };
}

/** Whether a screen point is on a pair's pill. */
export function onKerningLabel(editor: Editor, pair: KerningPair, point: ScreenPoint): boolean {
  return Rect.containsPoint(kerningLabelLayout(editor, pair).pill, point);
}
