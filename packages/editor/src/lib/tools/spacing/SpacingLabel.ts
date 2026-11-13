import { Rect, type Rect2D } from "@shift/geo";
import type { Editor } from "../../editor/Editor";
import { localPoint } from "../../editor/spaces";
import type { ScreenPoint } from "../../../types/coordinates";
import { spacingBoundary } from "../../../types/spacing";
import type { SpacingHalf } from "./RunSpacing";

const HEIGHT_PX = 16;
const PADDING_PX = 4;
/** Width of one character of the label font; the pill sizes from it, so drawing and hits agree. */
const CHARACTER_WIDTH_PX = 6;

/**
 * The text a half's pill shows: its sidebearing in whole units. A linked
 * half shows the same number, marked by the pill's style instead.
 */
export function spacingLabelText(_editor: Editor, half: SpacingHalf): string | null {
  const glyphSide = half.glyphSide;
  if (!glyphSide) return null;

  return String(Math.round(glyphSide.sidebearing));
}

/** What a linked half's pill shows on hover: the key's source, without `=` or `==`. */
export function spacingLabelSource(editor: Editor, half: SpacingHalf): string | null {
  const key = half.linkKey(editor);
  if (key === null) return null;

  const body = key.replace(/^==?/, "").trim();
  if (body !== "|") return body;

  return half.sidebearing === "lsb" ? "RSB" : "LSB";
}

/** The pill's width for `text`, in screen pixels. */
export function spacingLabelWidth(text: string): number {
  return text.length * CHARACTER_WIDTH_PX + PADDING_PX * 2;
}

/** The middle of a half, in screen pixels: where its pill sits. */
export function spacingLabelCenter(editor: Editor, half: SpacingHalf): ScreenPoint | null {
  const glyphSide = half.glyphSide;
  if (!glyphSide) return null;

  const { gap } = half;
  const boundary = spacingBoundary(gap, half.side);
  const middle = localPoint((glyphSide.edge + boundary) / 2, (gap.top + gap.bottom) / 2);
  return editor.sceneToScreen(editor.toScene(gap.node, middle));
}

/** A half's pill, in screen pixels; drawing and clicks both use it. */
export function spacingLabelRect(editor: Editor, half: SpacingHalf): Rect2D | null {
  const center = spacingLabelCenter(editor, half);
  const text = spacingLabelText(editor, half);
  if (!center || !text) return null;

  const width = spacingLabelWidth(text);
  const x = Math.round(center.x - width / 2);
  const y = Math.round(center.y - HEIGHT_PX / 2);
  return Rect.fromXYWH(x, y, width, HEIGHT_PX);
}
