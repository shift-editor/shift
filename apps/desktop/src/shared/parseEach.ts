import type { z } from "zod";

/**
 * Reads JSON text as a list, keeping each entry `schema` accepts.
 *
 * @remarks
 * Entries are checked one at a time, so one malformed entry cannot lose the
 * rest. Text that is not JSON, or JSON that is not an array, reads as empty.
 *
 * @param schema - Accepts and shapes one entry.
 * @param text - Stored JSON text.
 */
export function parseEach<Schema extends z.ZodType>(
  schema: Schema,
  text: string,
): z.output<Schema>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((value) => {
    const result = schema.safeParse(value);
    return result.success ? [result.data] : [];
  });
}
