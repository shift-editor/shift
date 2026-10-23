import type { PointType } from "@shift/types";

const VALID_POINT_TYPES: ReadonlySet<string> = new Set<PointType>(["onCurve", "offCurve"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidPoint(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (typeof v.x !== "number" || !Number.isFinite(v.x)) return false;
  if (typeof v.y !== "number" || !Number.isFinite(v.y)) return false;
  if (typeof v.pointType !== "string" || !VALID_POINT_TYPES.has(v.pointType)) return false;
  if (typeof v.smooth !== "boolean") return false;
  return true;
}

function isValidContour(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (typeof v.closed !== "boolean") return false;
  if (!Array.isArray(v.points)) return false;
  return v.points.every((p: unknown) => isValidPoint(p));
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isValidSizing(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (v.kind === "hug" || v.kind === "fill") return true;
  return v.kind === "fixed" && isFiniteNumber(v.size) && v.size >= 0;
}

function isValidTextBoxItem(v: unknown): boolean {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case "character":
      return isFiniteNumber(v.codepoint);
    case "glyph":
      return typeof v.name === "string";
    case "linebreak":
      return true;
    default:
      return false;
  }
}

function isValidTextBox(v: unknown): boolean {
  if (!isRecord(v) || !isRecord(v.position)) return false;
  if (!isFiniteNumber(v.position.x) || !isFiniteNumber(v.position.y)) return false;
  if (!isFiniteNumber(v.size) || v.size <= 0 || !isFiniteNumber(v.rotation)) return false;
  if (!isValidSizing(v.width) || !isValidSizing(v.height)) return false;
  const align = v.verticalAlign;
  if (align !== undefined && align !== "top" && align !== "middle" && align !== "bottom")
    return false;
  return Array.isArray(v.items) && v.items.every((item: unknown) => isValidTextBoxItem(item));
}

export const ValidateClipboard = {
  isShiftContent(v: unknown): boolean {
    if (!isRecord(v)) return false;
    if (!Array.isArray(v.contours)) return false;
    if (!v.contours.every((c: unknown) => isValidContour(c))) return false;
    if (v.textBoxes === undefined) return true;
    return Array.isArray(v.textBoxes) && v.textBoxes.every((box: unknown) => isValidTextBox(box));
  },

  isClipboardPayload(v: unknown): boolean {
    if (!isRecord(v)) return false;
    if (v.format !== "shift/glyph-data") return false;
    if (typeof v.version !== "number") return false;
    if (!isRecord(v.metadata)) return false;
    if (typeof v.metadata.timestamp !== "number") return false;
    return ValidateClipboard.isShiftContent(v.content);
  },
} as const;
