import type { PersistenceModule } from "../module";
import type { ToolStateScope } from "@/lib/tools/core";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createToolStateModule(
  id: string,
  scope: ToolStateScope,
): PersistenceModule<Record<string, unknown>> {
  return {
    id,
    scope,
    version: 1,
    capture: ({ editor }) => {
      const snapshot = editor.exportToolState(scope);
      return Object.keys(snapshot).length > 0 ? snapshot : null;
    },
    hydrate: ({ editor }, payload) => {
      editor.hydrateToolState(scope, payload);
    },
    clear: ({ editor }) => {
      editor.clearToolState(scope);
    },
    validate: (payload: unknown): payload is Record<string, unknown> => isRecord(payload),
  };
}

export const toolStateAppModule = createToolStateModule("tool-state-app", "app");
export const toolStateDocumentModule = createToolStateModule("tool-state-document", "document");
