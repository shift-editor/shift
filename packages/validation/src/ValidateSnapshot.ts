import type {
  PointType,
  PointSnapshot,
  ContourSnapshot,
  AnchorSnapshot,
  RenderPointSnapshot,
  RenderContourSnapshot,
  GlyphSnapshot,
} from "@shift/types";
import type { ValidationResult } from "./types";
import { Validate } from "./Validate";

const VALID_POINT_TYPES: ReadonlySet<string> = new Set<string>(["onCurve", "offCurve"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export const ValidateSnapshot = {
  isValidPointType(v: unknown): v is PointType {
    return typeof v === "string" && VALID_POINT_TYPES.has(v);
  },

  isPointSnapshot(v: unknown): v is PointSnapshot {
    if (!isRecord(v)) return false;
    if (typeof v.id !== "string") return false;
    if (typeof v.x !== "number" || !Number.isFinite(v.x)) return false;
    if (typeof v.y !== "number" || !Number.isFinite(v.y)) return false;
    if (!ValidateSnapshot.isValidPointType(v.pointType)) return false;
    if (typeof v.smooth !== "boolean") return false;
    return true;
  },

  isContourSnapshot(v: unknown): v is ContourSnapshot {
    if (!isRecord(v)) return false;
    if (typeof v.id !== "string") return false;
    if (typeof v.closed !== "boolean") return false;
    if (!Array.isArray(v.points)) return false;
    return v.points.every((p: unknown) => ValidateSnapshot.isPointSnapshot(p));
  },

  isAnchorSnapshot(v: unknown): v is AnchorSnapshot {
    if (!isRecord(v)) return false;
    if (typeof v.id !== "string") return false;
    if (v.name !== null && typeof v.name !== "string") return false;
    if (typeof v.x !== "number" || !Number.isFinite(v.x)) return false;
    if (typeof v.y !== "number" || !Number.isFinite(v.y)) return false;
    return true;
  },

  isRenderPointSnapshot(v: unknown): v is RenderPointSnapshot {
    if (!isRecord(v)) return false;
    if (typeof v.x !== "number" || !Number.isFinite(v.x)) return false;
    if (typeof v.y !== "number" || !Number.isFinite(v.y)) return false;
    if (!ValidateSnapshot.isValidPointType(v.pointType)) return false;
    if (typeof v.smooth !== "boolean") return false;
    return true;
  },

  isRenderContourSnapshot(v: unknown): v is RenderContourSnapshot {
    if (!isRecord(v)) return false;
    if (typeof v.closed !== "boolean") return false;
    if (!Array.isArray(v.points)) return false;
    return v.points.every((p: unknown) => ValidateSnapshot.isRenderPointSnapshot(p));
  },

  isGlyphSnapshot(v: unknown): v is GlyphSnapshot {
    if (!isRecord(v)) return false;
    if (typeof v.unicode !== "number" || !Number.isFinite(v.unicode)) return false;
    if (typeof v.name !== "string") return false;
    if (typeof v.xAdvance !== "number" || !Number.isFinite(v.xAdvance)) return false;
    if (!Array.isArray(v.contours)) return false;
    if (!Array.isArray(v.anchors)) return false;
    if (!Array.isArray(v.compositeContours)) return false;
    if (v.activeContourId !== null && typeof v.activeContourId !== "string") return false;
    return (
      v.contours.every((c: unknown) => ValidateSnapshot.isContourSnapshot(c)) &&
      v.anchors.every((a: unknown) => ValidateSnapshot.isAnchorSnapshot(a)) &&
      v.compositeContours.every((c: unknown) => ValidateSnapshot.isRenderContourSnapshot(c))
    );
  },

  glyphSnapshot(v: unknown): ValidationResult<GlyphSnapshot> {
    if (!isRecord(v)) {
      return Validate.fail(Validate.error("INVALID_SNAPSHOT_STRUCTURE", "Expected an object"));
    }

    if (typeof v.unicode !== "number" || !Number.isFinite(v.unicode)) {
      return Validate.fail(
        Validate.error("INVALID_SNAPSHOT_STRUCTURE", "Invalid or missing 'unicode' field", {
          field: "unicode",
          value: v.unicode,
        }),
      );
    }

    if (typeof v.name !== "string") {
      return Validate.fail(
        Validate.error("INVALID_SNAPSHOT_STRUCTURE", "Invalid or missing 'name' field", {
          field: "name",
          value: v.name,
        }),
      );
    }

    if (typeof v.xAdvance !== "number" || !Number.isFinite(v.xAdvance)) {
      return Validate.fail(
        Validate.error("INVALID_SNAPSHOT_STRUCTURE", "Invalid or missing 'xAdvance' field", {
          field: "xAdvance",
          value: v.xAdvance,
        }),
      );
    }

    if (!Array.isArray(v.contours)) {
      return Validate.fail(
        Validate.error("INVALID_SNAPSHOT_STRUCTURE", "Invalid or missing 'contours' field", {
          field: "contours",
        }),
      );
    }

    if (!Array.isArray(v.anchors)) {
      return Validate.fail(
        Validate.error("INVALID_SNAPSHOT_STRUCTURE", "Invalid or missing 'anchors' field", {
          field: "anchors",
        }),
      );
    }

    if (!Array.isArray(v.compositeContours)) {
      return Validate.fail(
        Validate.error(
          "INVALID_SNAPSHOT_STRUCTURE",
          "Invalid or missing 'compositeContours' field",
          {
            field: "compositeContours",
          },
        ),
      );
    }

    if (v.activeContourId !== null && typeof v.activeContourId !== "string") {
      return Validate.fail(
        Validate.error("INVALID_SNAPSHOT_STRUCTURE", "Invalid 'activeContourId' field", {
          field: "activeContourId",
          value: v.activeContourId,
        }),
      );
    }

    for (let i = 0; i < v.contours.length; i++) {
      const contour = v.contours[i];
      if (!ValidateSnapshot.isContourSnapshot(contour)) {
        return Validate.fail(
          Validate.error("INVALID_CONTOUR_STRUCTURE", `Invalid contour at index ${i}`, {
            index: i,
          }),
        );
      }
    }

    for (let i = 0; i < v.anchors.length; i++) {
      const anchor = v.anchors[i];
      if (!ValidateSnapshot.isAnchorSnapshot(anchor)) {
        return Validate.fail(
          Validate.error("INVALID_SNAPSHOT_STRUCTURE", `Invalid anchor at index ${i}`, {
            index: i,
          }),
        );
      }
    }

    for (let i = 0; i < v.compositeContours.length; i++) {
      const contour = v.compositeContours[i];
      if (!ValidateSnapshot.isRenderContourSnapshot(contour)) {
        return Validate.fail(
          Validate.error("INVALID_SNAPSHOT_STRUCTURE", `Invalid composite contour at index ${i}`, {
            index: i,
          }),
        );
      }
    }

    return Validate.ok(v as GlyphSnapshot);
  },
} as const;
