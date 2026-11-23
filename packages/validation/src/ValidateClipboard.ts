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

const VALID_STROKE_CAPS: ReadonlySet<string> = new Set(["butt", "square", "round"]);
const VALID_STROKE_JOINS: ReadonlySet<string> = new Set(["bevel", "miter", "round"]);

/** A pasted contour's dynamic stroke, checked only when the field is present. */
function isValidStroke(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (typeof v.width !== "number" || !Number.isFinite(v.width) || v.width <= 0) return false;
  if (typeof v.cap !== "string" || !VALID_STROKE_CAPS.has(v.cap)) return false;
  if (typeof v.join !== "string" || !VALID_STROKE_JOINS.has(v.join)) return false;
  if (typeof v.miterLimit !== "number" || !Number.isFinite(v.miterLimit)) return false;
  if (typeof v.position !== "number" || !Number.isFinite(v.position)) return false;
  return true;
}

function isValidContour(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (typeof v.closed !== "boolean") return false;
  if (!Array.isArray(v.points)) return false;
  if (v.stroke !== undefined && !isValidStroke(v.stroke)) return false;
  return v.points.every((p: unknown) => isValidPoint(p));
}

export const ValidateClipboard = {
  isShiftContent(v: unknown): boolean {
    if (!isRecord(v)) return false;
    if (!Array.isArray(v.contours)) return false;
    return v.contours.every((c: unknown) => isValidContour(c));
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
