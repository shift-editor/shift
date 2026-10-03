import { asGlyphId, asSourceId } from "@shift/types";
import * as z from "zod/v4";

const windowId = z.number().int().positive();
const glyphId = z.string().min(1).transform(asGlyphId);
const sourceId = z.string().min(1).transform(asSourceId);

/** Validates untrusted scripting inputs before they enter a host capability. */
export const shiftInputSchemas = {
  "font.get": z.strictObject({ windowId }),
  "glyphs.list": z.strictObject({
    windowId,
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(1024).optional(),
    sourceId: sourceId.optional(),
  }),
  "glyphs.get": z.union([
    z.strictObject({ windowId, glyphId }),
    z.strictObject({ windowId, name: z.string().min(1) }),
  ]),
  "layers.get": z.strictObject({ windowId, glyphId, sourceId }),
} as const;
