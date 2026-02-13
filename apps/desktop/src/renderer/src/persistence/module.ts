import type { Editor } from "@/lib/editor/Editor";
import type { PersistenceScope } from "./types";

export interface ModuleCaptureContext {
  editor: Editor;
}

export interface ModuleHydrateContext {
  editor: Editor;
}

export interface PersistenceModule<TPayload = unknown> {
  id: string;
  scope: PersistenceScope;
  version: number;
  capture(ctx: ModuleCaptureContext): TPayload | null;
  hydrate(ctx: ModuleHydrateContext, payload: TPayload): void;
  validate(payload: unknown): payload is TPayload;
  migrate?(payload: unknown, fromVersion: number, toVersion: number): TPayload;
}
