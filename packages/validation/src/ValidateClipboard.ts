import { ValidateSnapshot } from "./ValidateSnapshot";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidPoint(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (typeof v.x !== "number" || !Number.isFinite(v.x)) return false;
  if (typeof v.y !== "number" || !Number.isFinite(v.y)) return false;
  if (!ValidateSnapshot.isValidPointType(v.pointType)) return false;
  if (typeof v.smooth !== "boolean") return false;
  return true;
}

function isValidContour(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (typeof v.closed !== "boolean") return false;
  if (!Array.isArray(v.points)) return false;
  return v.points.every((p: unknown) => isValidPoint(p));
}

export const ValidateClipboard = {
  isClipboardContent(v: unknown): boolean {
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
    return ValidateClipboard.isClipboardContent(v.content);
  },
} as const;
