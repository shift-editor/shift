import type { PersistenceScope } from "./types";
import type { PersistedTextRun } from "@/lib/editor/managers/TextRunManager";
import type { SnapPreferences } from "@/types/editor";
import type { ToolStateScope } from "@/lib/tools/core";

export interface PersistenceEditorAPI {
  getSnapPreferences(): SnapPreferences;
  setSnapPreferences(next: Partial<SnapPreferences>): void;
  exportTextRuns(): Record<string, PersistedTextRun>;
  hydrateTextRuns(runsByGlyph: Record<string, PersistedTextRun>): void;
  exportToolState(scope: ToolStateScope): Record<string, unknown>;
  hydrateToolState(scope: ToolStateScope, state: Record<string, unknown>): void;
  clearToolState(scope: ToolStateScope): void;
}

export interface ModuleCaptureContext {
  editor: PersistenceEditorAPI;
}

export interface ModuleHydrateContext {
  editor: PersistenceEditorAPI;
}

export interface PersistenceModule<TPayload = unknown> {
  id: string;
  scope: PersistenceScope;
  version: number;
  capture(ctx: ModuleCaptureContext): TPayload | null;
  hydrate(ctx: ModuleHydrateContext, payload: TPayload): void;
  clear?(ctx: ModuleHydrateContext): void;
  validate(payload: unknown): payload is TPayload;
  migrate?(payload: unknown, fromVersion: number, toVersion: number): TPayload;
}
