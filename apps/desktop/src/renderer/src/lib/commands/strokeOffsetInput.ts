import { DEFAULT_STROKE_STYLE, type Editor } from "@shift/editor";
import type { StrokeCommandResult, StrokeOffsetFields, StrokeOffsetInput } from "@/types/stroke";
import { offsetSelectedContour } from "./strokeCommands";

/** The smallest miter limit that still means something, as in the Stroke section. */
const MIN_MITER_LIMIT = 1;

/** What the Offset Contour dialog starts with: 10 units, and the join and limit new strokes start with. */
export const DEFAULT_OFFSET_FIELDS: StrokeOffsetFields = {
  distance: "10",
  join: DEFAULT_STROKE_STYLE.join,
  miterLimit: String(DEFAULT_STROKE_STYLE.miterLimit),
};

/**
 * Reads the Offset Contour dialog's fields as an offset, or says what is wrong with them.
 *
 * @remarks
 * The sign of the distance is kept: it picks the side of the path. The miter limit is read
 * only while the join is miter, so a stale value in a hidden field never blocks an offset.
 */
export function readOffsetInput(fields: StrokeOffsetFields): StrokeOffsetInput {
  const distance = readNumber(fields.distance, "distance");
  if (distance.kind === "invalid") return distance;
  if (distance.amount === 0) {
    return invalid("The distance cannot be zero: it would not move the contour.");
  }

  const { join } = fields;
  if (join !== "miter") {
    const miterLimit = DEFAULT_STROKE_STYLE.miterLimit;
    return { kind: "ready", request: { distance: distance.amount, join, miterLimit } };
  }

  const miterLimit = readNumber(fields.miterLimit, "miter limit");
  if (miterLimit.kind === "invalid") return miterLimit;
  if (miterLimit.amount < MIN_MITER_LIMIT) {
    return invalid(`The miter limit must be at least ${MIN_MITER_LIMIT}.`);
  }

  return {
    kind: "ready",
    request: { distance: distance.amount, join, miterLimit: miterLimit.amount },
  };
}

/**
 * Offsets the selected contour by what the dialog's fields hold.
 *
 * A field that cannot be read refuses with its problem, as the engine refuses with its reason,
 * and the document stays as it was.
 */
export function offsetContourFromFields(
  editor: Editor,
  fields: StrokeOffsetFields,
): StrokeCommandResult {
  const input = readOffsetInput(fields);
  if (input.kind === "invalid") return { ok: false, reason: input.problem };

  return offsetSelectedContour(editor, input.request);
}

type NumberReading =
  | { readonly kind: "number"; readonly amount: number }
  | Extract<StrokeOffsetInput, { kind: "invalid" }>;

/** `text` as a finite number: a plain minus, a typographic one or a plus may lead it. */
function readNumber(text: string, name: string): NumberReading {
  const trimmed = text.trim().replace("−", "-");
  if (trimmed === "") return invalid(`Enter a ${name}.`);

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return invalid(`The ${name} must be a number.`);

  return { kind: "number", amount: value };
}

function invalid(problem: string): Extract<StrokeOffsetInput, { kind: "invalid" }> {
  return { kind: "invalid", problem };
}
