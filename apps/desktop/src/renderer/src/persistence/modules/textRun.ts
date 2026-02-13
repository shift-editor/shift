import type { PersistenceModule } from "../module";
import type { TextRunModulePayload } from "../types";
import { TextRunModulePayloadSchema } from "@shift/validation";

export const textRunModule: PersistenceModule<TextRunModulePayload> = {
  id: "text-run",
  scope: "document",
  version: 1,
  capture: ({ editor }) => ({
    runsByGlyph: editor.exportTextRuns(),
  }),
  hydrate: ({ editor }, payload) => {
    editor.hydrateTextRuns(payload.runsByGlyph);
  },
  clear: ({ editor }) => {
    editor.hydrateTextRuns({});
  },
  validate: (payload: unknown): payload is TextRunModulePayload =>
    TextRunModulePayloadSchema.safeParse(payload).success,
};
